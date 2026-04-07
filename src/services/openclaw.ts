import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Send a WhatsApp message via OpenClaw API.
 */
export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const url = `${config.openclaw.apiUrl}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.openclaw.apiKey}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error(`OpenClaw send failed: ${response.status} ${err}`);
      throw new Error(`Failed to send message: ${response.status}`);
    }

    logger.debug(`Message sent to ${to}: ${text.substring(0, 50)}...`);
  } catch (error) {
    logger.error('Failed to send WhatsApp message', { error, to });
    throw error;
  }
}

/**
 * Download media from OpenClaw (for image messages).
 */
export async function downloadMedia(mediaId: string): Promise<Buffer> {
  const url = `${config.openclaw.apiUrl}/media/${mediaId}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${config.openclaw.apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
