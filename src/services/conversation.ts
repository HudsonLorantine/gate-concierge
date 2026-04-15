import { ConversationSession, ConversationState } from '../types';
import { findResidentByPhone, isAuthorizedResident } from '../modules/residents';
import { createVisitorPass, getTodayPassesByResident, getActivePassesByResident, cancelPass } from '../modules/visitor-passes';
import { validatePlate } from '../modules/plate-recognition';
import { extractPlateFromImage } from './ocr';
import { createAuditLog } from '../modules/audit';
import { sendWhatsAppMessage, downloadMedia } from './openclaw';
import { normalizePlate, isValidPlateFormat } from '../utils/plate';
import { logger } from '../utils/logger';
import { config } from '../config';
import path from 'path';
import fs from 'fs';

export interface MessageContext {
  senderPhone: string;
  chatId?: string;
  isGroup?: boolean;
  groupName?: string;
}

// In-memory conversation sessions (sufficient for MVP)
const sessions = new Map<string, ConversationSession>();

const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

const GROUP_TRIGGER_REGEX = /^(?:luna\b|\/)/i;

function getSessionKey(phone: string, context?: MessageContext): string {
  if (context?.isGroup && context.chatId) {
    return `${context.chatId}:${phone}`;
  }
  return phone;
}

function getSession(phone: string, context?: MessageContext): ConversationSession {
  const key = getSessionKey(phone, context);
  let session = sessions.get(key);
  if (!session || Date.now() - session.updated_at > SESSION_TIMEOUT) {
    session = { phone: key, state: 'idle', data: {}, updated_at: Date.now() };
    sessions.set(key, session);
  }
  return session;
}

function updateSession(phone: string, state: ConversationState, data?: Record<string, string>, context?: MessageContext): void {
  const session = getSession(phone, context);
  session.state = state;
  if (data) session.data = { ...session.data, ...data };
  session.updated_at = Date.now();
  sessions.set(getSessionKey(phone, context), session);
}

function clearSession(phone: string, context?: MessageContext): void {
  const key = getSessionKey(phone, context);
  sessions.set(key, { phone: key, state: 'idle', data: {}, updated_at: Date.now() });
}

/**
 * Main handler for incoming WhatsApp text messages.
 * Returns null for group messages that should be ignored (no trigger, no active session).
 */
export async function handleTextMessage(from: string, text: string, context: MessageContext = { senderPhone: from }): Promise<string | null> {
  const session = getSession(from, context);
  const isGroup = !!context.isGroup;
  let input = text.trim();

  // In groups: require trigger only when idle, strip it when present
  if (isGroup) {
    const shouldRequireTrigger = session.state === 'idle';
    if (shouldRequireTrigger && !GROUP_TRIGGER_REGEX.test(input)) {
      return null;
    }
    if (GROUP_TRIGGER_REGEX.test(input)) {
      input = input.replace(/^luna\b[:,\s-]*/i, '').replace(/^\//, '').trim();
    }
  }

  const inputLower = input.toLowerCase();

  // Check authorization
  if (!isAuthorizedResident(from)) {
    return '🚫 Sorry, your number is not registered as an authorized resident.\n\nPlease contact your building management to get registered.';
  }

  const resident = findResidentByPhone(from)!;

  // Global commands (available from any state)
  if (inputLower === 'help' || inputLower === 'menu') {
    clearSession(from, context);
    return formatHelp();
  }

  if (inputLower === 'cancel' && session.state !== 'idle') {
    clearSession(from, context);
    return '❎ Action cancelled. Type *help* for commands.';
  }

  // Handle based on current state
  switch (session.state) {
    case 'idle':
      return handleIdleState(from, input, inputLower, resident, context);

    case 'register_name':
      return handleRegisterName(from, input, resident, context);

    case 'register_plate':
      return handleRegisterPlate(from, input, resident, context);

    case 'register_datetime':
      return handleRegisterDatetime(from, input, resident, context);

    case 'register_notes':
      return handleRegisterNotes(from, input, resident, context);

    case 'register_confirm':
      return handleRegisterConfirm(from, input, resident, context);

    case 'cancel_select':
      return handleCancelSelect(from, input, resident, context);

    default:
      clearSession(from, context);
      return 'Something went wrong. Type *help* for available commands.';
  }
}

/**
 * Handle image messages (plate validation flow).
 */
export async function handleImageMessage(from: string, mediaId: string, caption?: string): Promise<string> {
  if (!isAuthorizedResident(from)) {
    return '🚫 Your number is not registered.';
  }

  try {
    // Download the image
    const imageBuffer = await downloadMedia(mediaId);
    const uploadsDir = config.uploads.dir;
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const filename = `plate_${Date.now()}_${from}.jpg`;
    const imagePath = path.join(uploadsDir, filename);
    fs.writeFileSync(imagePath, imageBuffer);

    // Run OCR
    const ocrResult = await extractPlateFromImage(imagePath);

    if (!ocrResult.best_match) {
      return '🔍 Could not detect a license plate in this image.\n\nPlease try again with a clearer photo of the vehicle plate.';
    }

    // Validate against active passes
    const validationResult = await validatePlate(
      ocrResult.best_match.plate,
      ocrResult.best_match.confidence,
      imagePath,
      'whatsapp'
    );

    return validationResult.message;
  } catch (error) {
    logger.error('Image processing failed', { error, from });
    return '⚠️ Failed to process image. Please try again.';
  }
}

// ─── State handlers ──────────────────────────────────────────

async function handleIdleState(from: string, input: string, inputLower: string, resident: any, context?: MessageContext): Promise<string> {
  // Try natural language parsing first
  const naturalParse = tryParseNaturalRegistration(input);
  if (naturalParse) {
    updateSession(from, 'register_confirm', naturalParse, context);
    return formatConfirmation(naturalParse, resident);
  }

  // Command-based flow
  if (inputLower === 'register' || inputLower === 'add' || inputLower === 'new') {
    updateSession(from, 'register_name', undefined, context);
    return '📝 *Register New Visitor*\n\nWhat is your visitor\'s name?';
  }

  if (inputLower === 'today' || inputLower === 'list') {
    const passes = getTodayPassesByResident(resident.id);
    if (passes.length === 0) {
      return '📋 No visitors registered for today.';
    }
    let msg = '📋 *Today\'s Visitors:*\n\n';
    passes.forEach((p, i) => {
      const time = new Date(p.expected_arrival).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: true });
      const statusEmoji = p.status === 'arrived' ? '✅' : p.status === 'cancelled' ? '❌' : '⏳';
      msg += `${i + 1}. ${statusEmoji} ${p.visitor_name} — ${p.car_plate} — ${time}\n`;
    });
    return msg;
  }

  if (inputLower === 'status' || inputLower === 'active') {
    const passes = getActivePassesByResident(resident.id);
    if (passes.length === 0) {
      return '📋 No active visitor passes.';
    }
    let msg = '📋 *Active Passes:*\n\n';
    passes.forEach((p, i) => {
      const start = new Date(p.validity_start).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: true });
      const end = new Date(p.validity_end).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: true });
      msg += `${i + 1}. ${p.visitor_name} — ${p.car_plate}\n   Valid: ${start} – ${end}\n`;
    });
    return msg;
  }

  if (inputLower.startsWith('cancel') || inputLower === 'delete') {
    const passes = getActivePassesByResident(resident.id);
    if (passes.length === 0) {
      return '📋 No active passes to cancel.';
    }
    let msg = '🗑️ *Cancel a Visitor Pass*\n\nWhich pass do you want to cancel?\n\n';
    passes.forEach((p, i) => {
      msg += `${i + 1}. ${p.visitor_name} — ${p.car_plate}\n`;
    });
    msg += '\nReply with the number, or type *cancel* to go back.';
    updateSession(from, 'cancel_select', { passes: JSON.stringify(passes.map(p => p.id)) }, context);
    return msg;
  }

  // Default
  return `👋 Hi ${resident.name}!\n\nWelcome to Gate Concierge.\n\n${formatHelp()}`;
}

async function handleRegisterName(from: string, input: string, _resident: any, context?: MessageContext): Promise<string> {
  if (input.length < 2) {
    return 'Please enter a valid visitor name.';
  }
  updateSession(from, 'register_plate', { visitor_name: input }, context);
  return `Got it — *${input}*\n\nWhat is their car plate number?`;
}

async function handleRegisterPlate(from: string, input: string, _resident: any, context?: MessageContext): Promise<string> {
  const plate = normalizePlate(input);
  if (!isValidPlateFormat(plate)) {
    return `"${input}" doesn't look like a valid plate number.\n\nPlease enter a plate like: VEP1234, W1234X, ABC123`;
  }
  updateSession(from, 'register_datetime', { car_plate: plate }, context);
  return `Plate: *${plate}*\n\nWhen are they expected to arrive?\n\nExamples:\n• tonight 7pm\n• 2pm\n• 7 Apr 8pm\n• tomorrow 10am`;
}

async function handleRegisterDatetime(from: string, input: string, _resident: any, context?: MessageContext): Promise<string> {
  const parsed = parseDateTime(input);
  if (!parsed) {
    return 'I couldn\'t understand that time. Please try again.\n\nExamples: "7pm", "tonight 8pm", "tomorrow 3pm", "7 Apr 7pm"';
  }
  updateSession(from, 'register_notes', { expected_arrival: parsed.toISOString() }, context);
  const formatted = parsed.toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });
  return `Arrival: *${formatted}*\n\nAny notes? (or type *skip*)`;
}

async function handleRegisterNotes(from: string, input: string, resident: any, context?: MessageContext): Promise<string> {
  const notes = input.toLowerCase() === 'skip' ? '' : input;
  updateSession(from, 'register_confirm', { notes }, context);
  const session = getSession(from, context);
  return formatConfirmation(session.data, resident);
}

async function handleRegisterConfirm(from: string, input: string, resident: any, context?: MessageContext): Promise<string> {
  const inputLower = input.toLowerCase();
  if (inputLower === 'yes' || inputLower === 'y' || inputLower === 'confirm' || inputLower === 'ok') {
    const session = getSession(from, context);
    const pass = createVisitorPass({
      residentId: resident.id,
      residentPhone: from,
      unitNumber: resident.unit_number,
      visitorName: session.data.visitor_name,
      carPlate: session.data.car_plate,
      expectedArrival: session.data.expected_arrival,
      notes: session.data.notes || undefined,
    });

    createAuditLog('visitor_pass', pass.id, 'created', from, `Visitor: ${pass.visitor_name}, Plate: ${pass.car_plate}`);

    const arrival = new Date(pass.expected_arrival).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });
    const validStart = new Date(pass.validity_start).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: true });
    const validEnd = new Date(pass.validity_end).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: true });

    clearSession(from, context);
    return `✅ *Visitor Registered!*\n\n👤 Guest: ${pass.visitor_name}\n🚗 Plate: ${pass.car_plate}\n📅 Arrival: ${arrival}\n⏰ Valid: ${validStart} – ${validEnd}\n🏠 Unit: ${pass.unit_number}${pass.notes ? `\n📝 Notes: ${pass.notes}` : ''}`;
  }

  if (inputLower === 'no' || inputLower === 'n') {
    clearSession(from, context);
    return '❎ Registration cancelled. Type *register* to start again.';
  }

  return 'Please reply *yes* to confirm or *no* to cancel.';
}

async function handleCancelSelect(from: string, input: string, _resident: any, context?: MessageContext): Promise<string> {
  const session = getSession(from, context);
  const passIds: string[] = JSON.parse(session.data.passes || '[]');
  const index = parseInt(input, 10) - 1;

  if (isNaN(index) || index < 0 || index >= passIds.length) {
    return `Please enter a number between 1 and ${passIds.length}.`;
  }

  const pass = cancelPass(passIds[index]);
  if (pass) {
    createAuditLog('visitor_pass', pass.id, 'cancelled', from, `Cancelled by resident`);
    clearSession(from, context);
    return `✅ Cancelled pass for *${pass.visitor_name}* (${pass.car_plate}).`;
  }

  clearSession(from, context);
  return '⚠️ Could not cancel that pass. It may have already been used or expired.';
}

// ─── Helpers ─────────────────────────────────────────────────

function formatHelp(): string {
  return `📖 *Commands:*\n\n• *register* — Register a new visitor\n• *today* — View today's visitors\n• *status* — View active passes\n• *cancel* — Cancel a visitor pass\n• *help* — Show this menu\n\n💡 You can also type naturally:\n_"My guest John coming tonight 7pm, plate VEP1234"_\n\n📷 Send a vehicle photo to check plate registration.`;
}

function formatConfirmation(data: Record<string, string>, resident: any): string {
  const arrival = new Date(data.expected_arrival).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });
  return `📋 *Please Confirm:*\n\n👤 Visitor: ${data.visitor_name}\n🚗 Plate: ${data.car_plate}\n📅 Arrival: ${arrival}\n🏠 Unit: ${resident.unit_number}${data.notes ? `\n📝 Notes: ${data.notes}` : ''}\n\nReply *yes* to confirm or *no* to cancel.`;
}

/**
 * Try to parse natural language like:
 * "My guest John Tan coming tonight 7pm, plate VEP1234"
 */
function tryParseNaturalRegistration(input: string): Record<string, string> | null {
  // Pattern: look for name, plate, and time indicators
  const plateMatch = input.match(/(?:plate|number|no\.?)\s*[:\s]?\s*([A-Za-z]{1,4}\s?\d{1,5}[A-Za-z]?)/i);
  if (!plateMatch) return null;

  const plate = normalizePlate(plateMatch[1]);
  if (!isValidPlateFormat(plate)) return null;

  // Try to find a name (before "coming", "arriving", "plate", etc.)
  const nameMatch = input.match(/(?:guest|visitor|friend)?\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(?:coming|arriving|will|is|at|tonight|tomorrow)/i);
  if (!nameMatch) return null;

  // Try to find time
  const timeMatch = input.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i) ||
                    input.match(/(tonight|tomorrow)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))?/i);
  if (!timeMatch) return null;

  const parsedTime = parseDateTime(timeMatch[0]);
  if (!parsedTime) return null;

  return {
    visitor_name: nameMatch[1].trim(),
    car_plate: plate,
    expected_arrival: parsedTime.toISOString(),
    notes: '',
  };
}

/**
 * Parse common time expressions into a Date.
 */
function parseDateTime(input: string): Date | null {
  const now = new Date();
  const text = input.toLowerCase().trim();

  // Extract time component
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2] || '0', 10);
  const ampm = timeMatch[3].toLowerCase();

  if (ampm === 'pm' && hours < 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;

  const result = new Date(now);

  // Check for date modifiers
  if (text.includes('tomorrow')) {
    result.setDate(result.getDate() + 1);
  } else {
    // Check for explicit date like "7 Apr" or "Apr 7"
    const dateMatch = text.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i) ||
                      text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*(\d{1,2})/i);
    if (dateMatch) {
      const months: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      const day = parseInt(dateMatch[1].match(/\d+/) ? dateMatch[1] : dateMatch[2], 10);
      const month = months[(dateMatch[1].match(/[a-z]+/i) ? dateMatch[1] : dateMatch[2]).toLowerCase()];
      if (month !== undefined) {
        result.setMonth(month);
        result.setDate(day);
      }
    } else if (text.includes('tonight')) {
      // keep today
    } else {
      // If the time has already passed today, assume tomorrow
      const testDate = new Date(result);
      testDate.setHours(hours, minutes, 0, 0);
      if (testDate < now) {
        result.setDate(result.getDate() + 1);
      }
    }
  }

  result.setHours(hours, minutes, 0, 0);
  return result;
}
