// ─── Resident ────────────────────────────────────────────────
export interface Resident {
  id: string;
  name: string;
  unit_number: string;
  phone_number: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

// ─── Visitor Pass ────────────────────────────────────────────
export type VisitorPassStatus = 'pending' | 'arrived' | 'expired' | 'cancelled' | 'denied';

export interface VisitorPass {
  id: string;
  resident_id: string;
  resident_phone: string;
  unit_number: string;
  visitor_name: string;
  car_plate: string;
  expected_arrival: string;
  validity_start: string;
  validity_end: string;
  notes: string | null;
  status: VisitorPassStatus;
  created_at: string;
  updated_at: string;
}

// ─── Plate Event ─────────────────────────────────────────────
export type PlateMatchResult = 'ALLOW' | 'MANUAL_CHECK' | 'DENY';

export interface PlateEvent {
  id: string;
  detected_plate: string;
  normalized_plate: string;
  confidence: number;
  image_path: string | null;
  matched_pass_id: string | null;
  result: PlateMatchResult;
  source: 'whatsapp' | 'camera' | 'manual';
  created_at: string;
}

// ─── Gate Action ─────────────────────────────────────────────
export type GateActionType = 'auto_open' | 'manual_open' | 'denied' | 'manual_review';

export interface GateAction {
  id: string;
  plate_event_id: string;
  pass_id: string | null;
  action: GateActionType;
  performed_by: string | null;
  notes: string | null;
  created_at: string;
}

// ─── Audit Log ───────────────────────────────────────────────
export interface AuditLog {
  id: string;
  entity_type: 'resident' | 'visitor_pass' | 'plate_event' | 'gate_action';
  entity_id: string;
  action: string;
  actor_phone: string | null;
  details: string | null;
  created_at: string;
}

// ─── WhatsApp / Conversation ─────────────────────────────────
export type ConversationState =
  | 'idle'
  | 'register_name'
  | 'register_plate'
  | 'register_datetime'
  | 'register_notes'
  | 'register_confirm'
  | 'cancel_select'
  | 'awaiting_plate_image';

export interface ConversationSession {
  phone: string;
  state: ConversationState;
  data: Record<string, string>;
  updated_at: number;
}

// ─── OpenClaw Webhook ────────────────────────────────────────
export interface OpenClawMessage {
  from: string;
  type: 'text' | 'image' | 'document';
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  timestamp: string;
}
