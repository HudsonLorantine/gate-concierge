import { Router, Request, Response } from 'express';
import { handleTextMessage, handleImageMessage } from '../services/conversation';
import { sendWhatsAppMessage } from '../services/openclaw';
import { logger } from '../utils/logger';
import { config } from '../config';

const router = Router();

/**
 * OpenClaw webhook verification (GET).
 */
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.openclaw.webhookSecret) {
    logger.info('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

/**
 * OpenClaw webhook for incoming messages (POST).
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    // Acknowledge immediately
    res.sendStatus(200);

    const body = req.body;

    // Extract message from OpenClaw payload
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) return;

    for (const message of messages) {
      const from = message.from;
      let reply: string;

      if (message.type === 'text' && message.text?.body) {
        reply = await handleTextMessage(from, message.text.body);
      } else if (message.type === 'image' && message.image?.id) {
        reply = await handleImageMessage(from, message.image.id, message.image.caption);
      } else {
        reply = 'I can only process text messages and vehicle photos right now. Type *help* for commands.';
      }

      // Send reply
      await sendWhatsAppMessage(from, reply);
    }
  } catch (error) {
    logger.error('Webhook processing error', { error });
  }
});

export default router;
