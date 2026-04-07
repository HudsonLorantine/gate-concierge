import { v4 as uuid } from 'uuid';
import { getDb } from '../database/db';
import { VisitorPass, VisitorPassStatus } from '../types';
import { normalizePlate } from '../utils/plate';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface CreatePassInput {
  residentId: string;
  residentPhone: string;
  unitNumber: string;
  visitorName: string;
  carPlate: string;
  expectedArrival: string; // ISO datetime
  notes?: string;
}

export function createVisitorPass(input: CreatePassInput): VisitorPass {
  const db = getDb();
  const id = uuid();
  const plate = normalizePlate(input.carPlate);

  // Calculate validity window
  const arrival = new Date(input.expectedArrival);
  const validityStart = new Date(arrival.getTime() - config.visitorPass.defaultValidityBeforeHours * 60 * 60 * 1000);
  const validityEnd = new Date(arrival.getTime() + config.visitorPass.defaultValidityAfterHours * 60 * 60 * 1000);

  db.prepare(`
    INSERT INTO visitor_passes (id, resident_id, resident_phone, unit_number, visitor_name, car_plate, expected_arrival, validity_start, validity_end, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    id,
    input.residentId,
    input.residentPhone,
    input.unitNumber,
    input.visitorName,
    plate,
    arrival.toISOString(),
    validityStart.toISOString(),
    validityEnd.toISOString(),
    input.notes || null
  );

  logger.info(`Visitor pass created: ${input.visitorName} (${plate}) for unit ${input.unitNumber}`);
  return getPassById(id)!;
}

export function getPassById(id: string): VisitorPass | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM visitor_passes WHERE id = ?').get(id) as VisitorPass | undefined;
}

export function getActivePassesByResident(residentId: string): VisitorPass[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM visitor_passes
    WHERE resident_id = ? AND status = 'pending'
    AND validity_end >= datetime('now')
    ORDER BY expected_arrival ASC
  `).all(residentId) as VisitorPass[];
}

export function getTodayPassesByResident(residentId: string): VisitorPass[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM visitor_passes
    WHERE resident_id = ?
    AND date(expected_arrival) = date('now')
    AND status IN ('pending', 'arrived')
    ORDER BY expected_arrival ASC
  `).all(residentId) as VisitorPass[];
}

export function getAllTodayPasses(): VisitorPass[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM visitor_passes
    WHERE date(expected_arrival) = date('now')
    ORDER BY expected_arrival ASC
  `).all() as VisitorPass[];
}

export function cancelPass(passId: string): VisitorPass | undefined {
  const db = getDb();
  db.prepare(`
    UPDATE visitor_passes SET status = 'cancelled', updated_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `).run(passId);
  return getPassById(passId);
}

export function markPassArrived(passId: string): VisitorPass | undefined {
  const db = getDb();
  db.prepare(`
    UPDATE visitor_passes SET status = 'arrived', updated_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `).run(passId);
  return getPassById(passId);
}

export function updatePassStatus(passId: string, status: VisitorPassStatus): void {
  const db = getDb();
  db.prepare(`
    UPDATE visitor_passes SET status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, passId);
}

export function findActivePassByPlate(plate: string): VisitorPass | undefined {
  const db = getDb();
  const normalized = normalizePlate(plate);
  return db.prepare(`
    SELECT * FROM visitor_passes
    WHERE car_plate = ?
    AND status = 'pending'
    AND validity_start <= datetime('now')
    AND validity_end >= datetime('now')
    ORDER BY expected_arrival ASC
    LIMIT 1
  `).get(normalized) as VisitorPass | undefined;
}

export function expireOldPasses(): number {
  const db = getDb();
  const result = db.prepare(`
    UPDATE visitor_passes SET status = 'expired', updated_at = datetime('now')
    WHERE status = 'pending' AND validity_end < datetime('now')
  `).run();
  return result.changes;
}

export function getRecentPasses(limit: number = 50): VisitorPass[] {
  const db = getDb();
  return db.prepare(`
    SELECT vp.*, r.name as resident_name FROM visitor_passes vp
    LEFT JOIN residents r ON vp.resident_id = r.id
    ORDER BY vp.created_at DESC LIMIT ?
  `).all(limit) as VisitorPass[];
}
