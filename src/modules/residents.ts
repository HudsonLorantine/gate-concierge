import { v4 as uuid } from 'uuid';
import { getDb } from '../database/db';
import { Resident } from '../types';
import { logger } from '../utils/logger';

export function findResidentByPhone(phone: string): Resident | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM residents WHERE phone_number = ? AND status = ?').get(phone, 'active') as Resident | undefined;
}

export function findResidentById(id: string): Resident | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM residents WHERE id = ?').get(id) as Resident | undefined;
}

export function getAllResidents(): Resident[] {
  const db = getDb();
  return db.prepare('SELECT * FROM residents ORDER BY unit_number').all() as Resident[];
}

export function createResident(name: string, unitNumber: string, phoneNumber: string): Resident {
  const db = getDb();
  const id = uuid();
  db.prepare(
    'INSERT INTO residents (id, name, unit_number, phone_number) VALUES (?, ?, ?, ?)'
  ).run(id, name, unitNumber, phoneNumber);
  logger.info(`Resident created: ${name} (${unitNumber})`);
  return findResidentById(id)!;
}

export function updateResident(id: string, updates: Partial<Pick<Resident, 'name' | 'unit_number' | 'phone_number' | 'status'>>): Resident | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: (string)[] = [];

  if (updates.name) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.unit_number) { fields.push('unit_number = ?'); values.push(updates.unit_number); }
  if (updates.phone_number) { fields.push('phone_number = ?'); values.push(updates.phone_number); }
  if (updates.status) { fields.push('status = ?'); values.push(updates.status); }

  if (fields.length === 0) return findResidentById(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE residents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  logger.info(`Resident updated: ${id}`);
  return findResidentById(id);
}

export function isAuthorizedResident(phone: string): boolean {
  const resident = findResidentByPhone(phone);
  return !!resident;
}
