/**
 * WhatsApp integration via Baileys (WhatsApp Web multi-device protocol).
 *
 * This module owns the direct connection to WhatsApp. It:
 *   • Pairs the bot with a user phone by printing a QR code (first run only)
 *   • Persists session credentials to disk so pairing survives restart
 *   • Receives inbound messages and dispatches them to the conversation
 *     state machine in ../services/conversation.ts
 *   • Provides a send() function used by conversation.ts to reply
 *
 * There is no Meta Business / Cloud API involved — the bot links against a
 * normal WhatsApp account the same way the WhatsApp Web browser tab does.
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  WASocket,
  WAMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import fs from 'fs';
import { config } from '../config';
import { logger } from '../utils/logger';

// ─── Module state ────────────────────────────────────────────

let sock: WASocket | null = null;
let currentQr: string | null = null; // last QR string emitted by Baileys
let connectionState: 'disconnected' | 'connecting' | 'qr' | 'open' = 'disconnected';
let lastError: string | null = null;
let connectedAt: number | null = null;
let pairedNumber: string | null = null;
let reconnectAttempts = 0;
let isShuttingDown = false; // set by stopWhatsApp() to suppress reconnect loop

// Lazy-load conversation handlers to avoid circular import at module init.
// (conversation.ts imports from this file indirectly via openclaw.ts facade.)
type ConvoModule = typeof import('./conversation');
let convo: ConvoModule | null = null;
async function getConvo(): Promise<ConvoModule> {
  if (!convo) convo = await import('./conversation');
  return convo;
}

// Baileys is noisy; route its logs through a silent pino logger and let
// our winston logger handle anything interesting via events.
const waLogger = pino({ level: 'silent' });

// ─── Public API ──────────────────────────────────────────────

export interface WhatsAppStatus {
  state: 'disconnected' | 'connecting' | 'qr' | 'open';
  connectedAt: number | null;
  pairedNumber: string | null;
  lastError: string | null;
  hasQr: boolean;
  reconnectAttempts: number;
}

export function getWhatsAppStatus(): WhatsAppStatus {
  return {
    state: connectionState,
    connectedAt,
    pairedNumber,
    lastError,
    hasQr: !!currentQr && connectionState === 'qr',
    reconnectAttempts,
  };
}

/** Return the current QR as a data URL PNG, or null if none pending. */
export async function getCurrentQrDataUrl(): Promise<string | null> {
  if (!currentQr) return null;
  return QRCode.toDataURL(currentQr, { margin: 1, width: 320 });
}

/** Return the current QR as raw PNG bytes, or null if none pending. */
export async function getCurrentQrPng(): Promise<Buffer | null> {
  if (!currentQr) return null;
  return QRCode.toBuffer(currentQr, { margin: 1, width: 320 });
}

/**
 * Send a text message to a WhatsApp number or JID.
 *
 * Accepts either:
 *   • a raw phone number (e.g. "60123456789" or "+60123456789")
 *   • a full JID ("60123456789@s.whatsapp.net" or "123456@g.us")
 */
export async function sendText(to: string, text: string): Promise<void> {
  if (!sock || connectionState !== 'open') {
    throw new Error(`WhatsApp socket not open (state=${connectionState})`);
  }
  const jid = toJid(to);
  await sock.sendMessage(jid, { text });
  logger.debug(`WA → ${jid}: ${text.substring(0, 60)}${text.length > 60 ? '…' : ''}`);
}

/**
 * Download media bytes for a previously received message, identified by its
 * WhatsApp message key (not a media ID — Baileys doesn't use Cloud API media IDs).
 *
 * We stash recent image messages in a small in-memory map keyed by a synthetic
 * ID we hand out to the conversation layer, so the existing handleImageMessage
 * signature (which takes a "mediaId" string) keeps working.
 */
const pendingMedia = new Map<string, WAMessage>();
const MEDIA_TTL_MS = 10 * 60 * 1000; // 10 minutes

function stashMedia(message: WAMessage): string {
  const id = `wa_${message.key.id ?? Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  pendingMedia.set(id, message);
  setTimeout(() => pendingMedia.delete(id), MEDIA_TTL_MS);
  return id;
}

export async function downloadStashedMedia(mediaId: string): Promise<Buffer> {
  const message = pendingMedia.get(mediaId);
  if (!message) throw new Error(`Media ${mediaId} not found or expired`);
  const buffer = await downloadMediaMessage(
    message,
    'buffer',
    {},
    { logger: waLogger as any, reuploadRequest: sock!.updateMediaMessage }
  );
  return buffer as Buffer;
}

// ─── Bootstrap ───────────────────────────────────────────────

/**
 * Start the WhatsApp socket. Safe to call multiple times — will no-op if
 * already connected or connecting.
 */
export async function startWhatsApp(): Promise<void> {
  if (sock && (connectionState === 'open' || connectionState === 'connecting')) {
    logger.debug(`WhatsApp already ${connectionState}, skipping start()`);
    return;
  }

  if (!config.whatsapp.enabled) {
    logger.info('WhatsApp disabled (WA_ENABLED=false) — socket not started');
    return;
  }

  // Reset shutdown flag so a start after stop (e.g. from logoutAndRepair)
  // doesn't get suppressed by a stale guard.
  isShuttingDown = false;

  // Ensure auth dir exists.
  if (!fs.existsSync(config.whatsapp.authDir)) {
    fs.mkdirSync(config.whatsapp.authDir, { recursive: true });
    logger.info(`Created WA auth dir: ${config.whatsapp.authDir}`);
  }

  const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(`Baileys starting (WA version ${version.join('.')}${isLatest ? '' : ' — outdated'})`);

  connectionState = 'connecting';
  lastError = null;

  sock = makeWASocket({
    version,
    logger: waLogger as any,
    auth: state,
    printQRInTerminal: false, // we handle QR rendering ourselves
    browser: ['Gate Concierge', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQr = qr;
      connectionState = 'qr';
      logger.info('╔════════════════════════════════════════════════════════════╗');
      logger.info('║  WhatsApp pairing required — scan QR from your phone       ║');
      logger.info('║  Phone → Settings → Linked Devices → Link a Device         ║');
      logger.info('║  Or open http://<host>/admin and use the WhatsApp panel    ║');
      logger.info('╚════════════════════════════════════════════════════════════╝');
      if (config.whatsapp.printQrInTerminal) {
        qrcodeTerminal.generate(qr, { small: true }, (rendered) => {
          // Write directly to stdout so it's not mangled by winston JSON
          process.stdout.write('\n' + rendered + '\n');
        });
      }
    }

    if (connection === 'open') {
      currentQr = null;
      connectionState = 'open';
      connectedAt = Date.now();
      reconnectAttempts = 0;
      pairedNumber = sock?.user?.id?.split(':')[0]?.split('@')[0] ?? null;
      logger.info(`WhatsApp connected as ${pairedNumber ?? 'unknown'}`);
    }

    if (connection === 'close') {
      const boom = lastDisconnect?.error as any;
      const statusCode: number | undefined = boom?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      lastError = boom?.message ?? 'connection closed';
      connectionState = 'disconnected';
      connectedAt = null;

      // If we're tearing down the process, do nothing — don't wipe auth,
      // don't schedule a reconnect, let the event loop drain.
      if (isShuttingDown) {
        logger.debug('WhatsApp socket closed during shutdown');
        return;
      }

      if (loggedOut) {
        logger.warn('WhatsApp logged out — clearing auth state, next start will require re-pairing');
        try {
          fs.rmSync(config.whatsapp.authDir, { recursive: true, force: true });
          fs.mkdirSync(config.whatsapp.authDir, { recursive: true });
        } catch (err) {
          logger.error('Failed to clear WA auth dir', { err });
        }
        // Restart after a brief pause so a fresh QR is emitted
        setTimeout(() => void startWhatsApp(), 2000);
        return;
      }

      reconnectAttempts++;
      const delay = Math.min(30_000, 1000 * Math.pow(2, Math.min(reconnectAttempts, 5)));
      logger.warn(`WhatsApp disconnected (${lastError}), reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
      setTimeout(() => void startWhatsApp(), delay);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages) {
      try {
        await handleIncomingMessage(message);
      } catch (err) {
        logger.error('WA inbound handler error', { err, messageId: message.key?.id });
      }
    }
  });
}

/**
 * Graceful shutdown. Closes the socket WITHOUT sending a logout frame —
 * pairing credentials stay intact on disk so the next boot reconnects
 * silently without a new QR scan.
 *
 * If you actually want to un-pair (wipe credentials, force re-scan), use
 * logoutAndRepair() instead.
 */
export async function stopWhatsApp(): Promise<void> {
  if (!sock) return;
  isShuttingDown = true;
  try {
    // end() closes the underlying websocket cleanly; no logout message sent.
    sock.end(undefined);
  } catch {
    // ignore — we're stopping anyway
  }
  sock = null;
  connectionState = 'disconnected';
  connectedAt = null;
  currentQr = null;
}

/**
 * Force a full re-pair: wipe the auth state and restart. Used by the admin
 * endpoint POST /api/whatsapp/logout.
 */
export async function logoutAndRepair(): Promise<void> {
  logger.info('WhatsApp logout requested via admin');
  try {
    if (sock) {
      try { await sock.logout(); } catch { /* ignore */ }
    }
  } finally {
    sock = null;
    connectionState = 'disconnected';
    connectedAt = null;
    pairedNumber = null;
    currentQr = null;
    try {
      fs.rmSync(config.whatsapp.authDir, { recursive: true, force: true });
      fs.mkdirSync(config.whatsapp.authDir, { recursive: true });
    } catch (err) {
      logger.error('Failed to clear WA auth dir on logout', { err });
    }
    // Kick off a fresh start — a new QR will be emitted
    setTimeout(() => void startWhatsApp(), 500);
  }
}

// ─── Inbound message dispatch ────────────────────────────────

async function handleIncomingMessage(message: WAMessage): Promise<void> {
  // Skip messages we sent ourselves (status reflections, echoes from other
  // linked devices, etc.). In self-chat mode a user messages their own
  // number, so we can't blanket-ignore fromMe — but we still want to skip
  // our own outbound sends.
  if (message.key.fromMe && !isSelfChat(message)) return;

  // Skip messages with no content (receipts, reactions, etc. we don't handle)
  if (!message.message) return;

  const remoteJid = message.key.remoteJid;
  if (!remoteJid) return;

  const isGroup = remoteJid.endsWith('@g.us');
  // In a group, `participant` is the actual sender. In a DM, the sender is
  // `remoteJid` itself. `fromMe` messages use the bot's own number.
  const senderJid = isGroup
    ? (message.key.participant ?? remoteJid)
    : (message.key.fromMe ? (sock?.user?.id ?? remoteJid) : remoteJid);

  const senderPhone = jidToPhone(senderJid);
  if (!senderPhone) return;

  // Resolve group name if possible (best-effort; not essential).
  let groupName: string | undefined;
  if (isGroup && sock) {
    try {
      const metadata = await sock.groupMetadata(remoteJid);
      groupName = metadata?.subject;
    } catch {
      // metadata lookup can fail for fresh groups — ignore
    }
  }

  const context = {
    senderPhone,
    chatId: remoteJid,
    isGroup,
    groupName,
  };

  const { handleTextMessage, handleImageMessage } = await getConvo();

  // Extract text / image content. Baileys messages can be nested under
  // several envelope types — we check the common ones.
  const msg = message.message;
  const textBody =
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    null;

  const imageMessage = msg.imageMessage;

  let reply: string | null = null;

  if (imageMessage) {
    // Stash the full WAMessage so we can download bytes on demand, hand out
    // a synthetic media ID to the conversation layer.
    const mediaId = stashMedia(message);
    reply = await handleImageMessage(senderPhone, mediaId, imageMessage.caption ?? undefined);
  } else if (textBody) {
    reply = await handleTextMessage(senderPhone, textBody, context);
  } else {
    // Unsupported message type — only respond in DMs, stay silent in groups
    if (!isGroup) {
      reply = 'I can only process text messages and vehicle photos right now. Type *help* for commands.';
    }
  }

  // Mark as read (best-effort)
  if (config.whatsapp.markRead && sock && message.key) {
    try {
      await sock.readMessages([message.key]);
    } catch {
      // ignore read-receipt failures
    }
  }

  // Send reply (null = silent, group message with no trigger)
  if (reply) {
    // Reply to the chat (group or DM), not necessarily the sender — this
    // matches how WhatsApp conversations actually work.
    await sock!.sendMessage(remoteJid, { text: reply });
    logger.debug(`WA ← ${remoteJid} [${senderPhone}] replied ${reply.substring(0, 60)}${reply.length > 60 ? '…' : ''}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function isSelfChat(message: WAMessage): boolean {
  // In self-chat (messaging yourself), fromMe is true AND remoteJid is the
  // bot's own JID. We still want to process those.
  const myJid = sock?.user?.id;
  if (!myJid || !message.key.remoteJid) return false;
  const myPhone = jidToPhone(myJid);
  const chatPhone = jidToPhone(message.key.remoteJid);
  return !!myPhone && myPhone === chatPhone;
}

/**
 * Normalize a phone number or JID to the form Baileys expects for sendMessage.
 */
function toJid(to: string): string {
  // Already a JID?
  if (to.includes('@')) return to;
  // Strip any non-digits (handles "+60 12 345 6789" style inputs)
  const digits = to.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

/**
 * Pull the bare phone number out of a JID.
 *   60123456789@s.whatsapp.net → "60123456789"
 *   60123456789:12@s.whatsapp.net → "60123456789"  (multi-device suffix stripped)
 *   12345@g.us → "" (group JIDs don't represent a person)
 */
function jidToPhone(jid: string): string {
  if (!jid) return '';
  if (jid.endsWith('@g.us')) return '';
  const local = jid.split('@')[0] ?? '';
  // Strip multi-device device ID suffix (":N")
  return local.split(':')[0] ?? '';
}

