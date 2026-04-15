/**
 * Admin endpoints for the WhatsApp (Baileys) connection.
 *
 * Mounted at /api/whatsapp by src/index.ts. All routes are protected by
 * adminAuth (HTTP basic) upstream of this router.
 *
 *   GET  /api/whatsapp/status        → { state, pairedNumber, hasQr, ... }
 *   GET  /api/whatsapp/qr.png        → PNG image of the current pairing QR
 *   GET  /api/whatsapp/qr            → { dataUrl }  (base64 PNG, for inline UI)
 *   POST /api/whatsapp/logout        → wipe session + re-emit a fresh QR
 *   POST /api/whatsapp/send          → { to, text } — manual outbound (debug)
 */

import { Router, Request, Response } from 'express';
import {
  getWhatsAppStatus,
  getCurrentQrDataUrl,
  getCurrentQrPng,
  logoutAndRepair,
  sendText,
} from '../services/whatsapp';
import { logger } from '../utils/logger';

const router = Router();

router.get('/status', (_req: Request, res: Response) => {
  res.json(getWhatsAppStatus());
});

router.get('/qr.png', async (_req: Request, res: Response) => {
  const png = await getCurrentQrPng();
  if (!png) {
    res.status(404).json({ error: 'No pairing QR available. Check /api/whatsapp/status.' });
    return;
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.send(png);
});

router.get('/qr', async (_req: Request, res: Response) => {
  const dataUrl = await getCurrentQrDataUrl();
  if (!dataUrl) {
    res.status(404).json({ error: 'No pairing QR available.' });
    return;
  }
  res.json({ dataUrl });
});

router.post('/logout', async (_req: Request, res: Response) => {
  try {
    await logoutAndRepair();
    res.json({ ok: true, message: 'Logged out — fresh QR will be emitted shortly.' });
  } catch (err: any) {
    logger.error('WhatsApp logout failed', { err });
    res.status(500).json({ error: err?.message ?? 'logout failed' });
  }
});

router.post('/send', async (req: Request, res: Response) => {
  const { to, text } = req.body ?? {};
  if (!to || !text) {
    res.status(400).json({ error: '"to" and "text" are required' });
    return;
  }
  try {
    await sendText(String(to), String(text));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'send failed' });
  }
});

export default router;
