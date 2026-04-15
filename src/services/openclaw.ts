/**
 * Backward-compat facade.
 *
 * The project used to send WhatsApp messages via an OpenClaw HTTP bridge.
 * That indirection has been removed — we now talk to WhatsApp directly via
 * Baileys. This file keeps the old function names (`sendWhatsAppMessage`,
 * `downloadMedia`) so `conversation.ts` and `routes/webhook.ts` don't need
 * to change. Both delegate to the real implementation in ./whatsapp.
 */

import { sendText, downloadStashedMedia } from './whatsapp';

/**
 * Send a WhatsApp text message to a phone number or JID.
 * Kept for API compatibility with the old OpenClaw-backed implementation.
 */
export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  return sendText(to, text);
}

/**
 * Fetch image bytes for a previously received message.
 *
 * Under the old OpenClaw integration, `mediaId` was a Cloud API media ID.
 * Under Baileys it's an internal stash key handed out by whatsapp.ts at the
 * moment the inbound image arrives — the lookup semantics are identical from
 * the caller's perspective.
 */
export async function downloadMedia(mediaId: string): Promise<Buffer> {
  return downloadStashedMedia(mediaId);
}
