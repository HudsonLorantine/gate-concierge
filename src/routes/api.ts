import { Router, Request, Response } from 'express';
import { getAllResidents, createResident, updateResident, findResidentById } from '../modules/residents';
import { createVisitorPass, getAllTodayPasses, getRecentPasses, cancelPass, getPassById, expireOldPasses, getActivePassesByResident } from '../modules/visitor-passes';
import { getRecentPlateEvents, validatePlate } from '../modules/plate-recognition';
import { getAuditLogs } from '../modules/audit';
import { createAuditLog } from '../modules/audit';
import { extractPlateFromImage } from '../services/ocr';
import { normalizePlate } from '../utils/plate';
import multer from 'multer';
import { config } from '../config';

const router = Router();

// File upload for plate images
const upload = multer({
  dest: config.uploads.dir,
  limits: { fileSize: config.uploads.maxFileSize },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ─── Residents ───────────────────────────────────────────────

router.get('/residents', (_req: Request, res: Response) => {
  res.json(getAllResidents());
});

router.get('/residents/:id', (req: Request, res: Response) => {
  const resident = findResidentById(String(req.params.id));
  if (!resident) {
    res.status(404).json({ error: 'Resident not found' });
    return;
  }
  res.json(resident);
});

router.post('/residents', (req: Request, res: Response) => {
  const { name, unit_number, phone_number } = req.body;
  if (!name || !unit_number || !phone_number) {
    res.status(400).json({ error: 'name, unit_number, and phone_number are required' });
    return;
  }
  try {
    const resident = createResident(name, unit_number, phone_number);
    res.status(201).json(resident);
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

router.put('/residents/:id', (req: Request, res: Response) => {
  const resident = updateResident(String(req.params.id), req.body);
  if (!resident) {
    res.status(404).json({ error: 'Resident not found' });
    return;
  }
  res.json(resident);
});

// ─── Visitor Passes ──────────────────────────────────────────

router.get('/passes/today', (_req: Request, res: Response) => {
  expireOldPasses();
  res.json(getAllTodayPasses());
});

router.get('/passes/recent', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(getRecentPasses(limit));
});

router.get('/passes/:id', (req: Request, res: Response) => {
  const pass = getPassById(String(req.params.id));
  if (!pass) {
    res.status(404).json({ error: 'Pass not found' });
    return;
  }
  res.json(pass);
});

/** Create a visitor pass via API */
router.post('/passes', (req: Request, res: Response) => {
  const { resident_id, visitor_name, car_plate, expected_arrival, notes } = req.body;

  if (!resident_id || !visitor_name || !car_plate || !expected_arrival) {
    res.status(400).json({ error: 'resident_id, visitor_name, car_plate, and expected_arrival are required' });
    return;
  }

  const resident = findResidentById(resident_id);
  if (!resident) {
    res.status(404).json({ error: 'Resident not found' });
    return;
  }

  try {
    const pass = createVisitorPass({
      residentId: resident.id,
      residentPhone: resident.phone_number,
      unitNumber: resident.unit_number,
      visitorName: visitor_name,
      carPlate: car_plate,
      expectedArrival: expected_arrival,
      notes,
    });

    createAuditLog('visitor_pass', pass.id, 'created_via_api', null,
      `Visitor: ${pass.visitor_name}, Plate: ${pass.car_plate}, Unit: ${pass.unit_number}`);

    res.status(201).json(pass);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/passes/:id/cancel', (req: Request, res: Response) => {
  const pass = cancelPass(String(req.params.id));
  if (!pass) {
    res.status(404).json({ error: 'Pass not found or already processed' });
    return;
  }
  createAuditLog('visitor_pass', pass.id, 'cancelled_via_api', null, `Cancelled: ${pass.visitor_name}`);
  res.json(pass);
});

// ─── Plate Validation ────────────────────────────────────────

router.post('/validate-plate', upload.single('image'), async (req: Request, res: Response) => {
  try {
    if (req.file) {
      const ocrResult = await extractPlateFromImage(req.file.path);
      if (!ocrResult.best_match) {
        res.json({ success: false, message: 'No plate detected in image', ocr: ocrResult });
        return;
      }
      const result = await validatePlate(ocrResult.best_match.plate, ocrResult.best_match.confidence, req.file.path, 'manual');
      res.json({ success: true, ...result, ocr: ocrResult });
    } else if (req.body.plate) {
      const result = await validatePlate(req.body.plate, 1.0, null, 'manual');
      res.json({ success: true, ...result });
    } else {
      res.status(400).json({ error: 'Provide "plate" in body or upload an image file' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Plate Events ────────────────────────────────────────────

router.get('/plate-events', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(getRecentPlateEvents(limit));
});

// ─── Audit Logs ──────────────────────────────────────────────

router.get('/audit-logs', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const entityType = req.query.entity_type as string | undefined;
  res.json(getAuditLogs(limit, entityType));
});

// ─── Dashboard Stats ─────────────────────────────────────────

router.get('/stats', (_req: Request, res: Response) => {
  const residents = getAllResidents();
  const todayPasses = getAllTodayPasses();
  const recentEvents = getRecentPlateEvents(100);

  res.json({
    total_residents: residents.length,
    active_residents: residents.filter(r => r.status === 'active').length,
    today_passes: todayPasses.length,
    today_pending: todayPasses.filter(p => p.status === 'pending').length,
    today_arrived: todayPasses.filter(p => p.status === 'arrived').length,
    recent_plate_events: recentEvents.length,
    recent_allowed: recentEvents.filter(e => e.result === 'ALLOW').length,
    recent_denied: recentEvents.filter(e => e.result === 'DENY').length,
  });
});

export default router;
