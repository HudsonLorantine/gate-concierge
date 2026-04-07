export const SCHEMA_SQL = `
-- Residents (Module A)
CREATE TABLE IF NOT EXISTS residents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit_number TEXT NOT NULL,
  phone_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_residents_phone ON residents(phone_number);
CREATE INDEX IF NOT EXISTS idx_residents_unit ON residents(unit_number);

-- Visitor Passes (Module B)
CREATE TABLE IF NOT EXISTS visitor_passes (
  id TEXT PRIMARY KEY,
  resident_id TEXT NOT NULL,
  resident_phone TEXT NOT NULL,
  unit_number TEXT NOT NULL,
  visitor_name TEXT NOT NULL,
  car_plate TEXT NOT NULL,
  expected_arrival TEXT NOT NULL,
  validity_start TEXT NOT NULL,
  validity_end TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'arrived', 'expired', 'cancelled', 'denied')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (resident_id) REFERENCES residents(id)
);

CREATE INDEX IF NOT EXISTS idx_passes_plate ON visitor_passes(car_plate);
CREATE INDEX IF NOT EXISTS idx_passes_status ON visitor_passes(status);
CREATE INDEX IF NOT EXISTS idx_passes_resident ON visitor_passes(resident_id);
CREATE INDEX IF NOT EXISTS idx_passes_validity ON visitor_passes(validity_start, validity_end);

-- Plate Events (Module C)
CREATE TABLE IF NOT EXISTS plate_events (
  id TEXT PRIMARY KEY,
  detected_plate TEXT NOT NULL,
  normalized_plate TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  image_path TEXT,
  matched_pass_id TEXT,
  result TEXT NOT NULL CHECK(result IN ('ALLOW', 'MANUAL_CHECK', 'DENY')),
  source TEXT NOT NULL DEFAULT 'whatsapp' CHECK(source IN ('whatsapp', 'camera', 'manual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (matched_pass_id) REFERENCES visitor_passes(id)
);

CREATE INDEX IF NOT EXISTS idx_plate_events_plate ON plate_events(normalized_plate);

-- Gate Actions (Module D - future)
CREATE TABLE IF NOT EXISTS gate_actions (
  id TEXT PRIMARY KEY,
  plate_event_id TEXT NOT NULL,
  pass_id TEXT,
  action TEXT NOT NULL CHECK(action IN ('auto_open', 'manual_open', 'denied', 'manual_review')),
  performed_by TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plate_event_id) REFERENCES plate_events(id),
  FOREIGN KEY (pass_id) REFERENCES visitor_passes(id)
);

-- Audit Logs (Module E)
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('resident', 'visitor_pass', 'plate_event', 'gate_action')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_phone TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
`;
