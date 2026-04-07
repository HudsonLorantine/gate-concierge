import { v4 as uuid } from 'uuid';
import { getDb } from '../database/db';
import { AuditLog } from '../types';

export function createAuditLog(
  entityType: AuditLog['entity_type'],
  entityId: string,
  action: string,
  actorPhone: string | null,
  details: string | null = null
): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO audit_logs (id, entity_type, entity_id, action, actor_phone, details) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(uuid(), entityType, entityId, action, actorPhone, details);
}

export function getAuditLogs(limit: number = 100, entityType?: string): AuditLog[] {
  const db = getDb();
  if (entityType) {
    return db.prepare(
      'SELECT * FROM audit_logs WHERE entity_type = ? ORDER BY created_at DESC LIMIT ?'
    ).all(entityType, limit) as AuditLog[];
  }
  return db.prepare(
    'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as AuditLog[];
}

export function getAuditLogsForEntity(entityType: string, entityId: string): AuditLog[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC'
  ).all(entityType, entityId) as AuditLog[];
}
