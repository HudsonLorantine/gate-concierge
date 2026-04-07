import { v4 as uuid } from 'uuid';
import { getDb } from '../database/db';
import { PlateEvent, PlateMatchResult } from '../types';
import { normalizePlate } from '../utils/plate';
import { findActivePassByPlate, markPassArrived } from './visitor-passes';
import { createAuditLog } from './audit';
import { logger } from '../utils/logger';

export interface PlateValidationResult {
  event: PlateEvent;
  matchedPass: {
    id: string;
    visitor_name: string;
    unit_number: string;
    resident_phone: string;
    validity_start: string;
    validity_end: string;
  } | null;
  result: PlateMatchResult;
  message: string;
}

export async function validatePlate(
  detectedPlate: string,
  confidence: number,
  imagePath: string | null,
  source: 'whatsapp' | 'camera' | 'manual' = 'whatsapp'
): Promise<PlateValidationResult> {
  const db = getDb();
  const normalized = normalizePlate(detectedPlate);
  const eventId = uuid();

  // Determine confidence threshold
  const isLowConfidence = confidence < 0.7;

  // Try to find matching active pass
  const matchedPass = findActivePassByPlate(normalized);

  let result: PlateMatchResult;
  let message: string;

  if (matchedPass && !isLowConfidence) {
    result = 'ALLOW';
    message = `✅ Plate: ${normalized}\nMatch: ${matchedPass.visitor_name}\nUnit: ${matchedPass.unit_number}\nValid: ${formatTime(matchedPass.validity_start)} – ${formatTime(matchedPass.validity_end)}\nResult: ALLOW ENTRY`;

    // Mark pass as arrived
    markPassArrived(matchedPass.id);
  } else if (matchedPass && isLowConfidence) {
    result = 'MANUAL_CHECK';
    message = `⚠️ Plate candidate: ${normalized} (?)\nPossible match: ${matchedPass.visitor_name}\nUnit: ${matchedPass.unit_number}\nConfidence: LOW (${Math.round(confidence * 100)}%)\nResult: MANUAL CHECK REQUIRED`;
  } else {
    result = 'DENY';
    message = `❌ Plate: ${normalized}\nNo matching visitor pass found.\nResult: NOT REGISTERED`;
  }

  // Record plate event
  db.prepare(`
    INSERT INTO plate_events (id, detected_plate, normalized_plate, confidence, image_path, matched_pass_id, result, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(eventId, detectedPlate, normalized, confidence, imagePath, matchedPass?.id || null, result, source);

  const event = db.prepare('SELECT * FROM plate_events WHERE id = ?').get(eventId) as PlateEvent;

  // Audit log
  createAuditLog('plate_event', eventId, `plate_validated:${result}`, null, `Plate: ${normalized}, Result: ${result}`);

  logger.info(`Plate validation: ${normalized} → ${result}`);

  return {
    event,
    matchedPass: matchedPass ? {
      id: matchedPass.id,
      visitor_name: matchedPass.visitor_name,
      unit_number: matchedPass.unit_number,
      resident_phone: matchedPass.resident_phone,
      validity_start: matchedPass.validity_start,
      validity_end: matchedPass.validity_end,
    } : null,
    result,
    message,
  };
}

export function getRecentPlateEvents(limit: number = 50): PlateEvent[] {
  const db = getDb();
  return db.prepare('SELECT * FROM plate_events ORDER BY created_at DESC LIMIT ?').all(limit) as PlateEvent[];
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: true });
}
