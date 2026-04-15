import path from 'path';

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    path: process.env.DATABASE_PATH || path.join(dataDir, 'gate-concierge.db'),
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'changeme',
  },

  visitorPass: {
    defaultValidityBeforeHours: parseInt(process.env.DEFAULT_VALIDITY_BEFORE_HOURS || '2', 10),
    defaultValidityAfterHours: parseInt(process.env.DEFAULT_VALIDITY_AFTER_HOURS || '4', 10),
  },

  uploads: {
    dir: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
    maxFileSize: 10 * 1024 * 1024, // 10MB
  },

  // ─── WhatsApp (Baileys, direct WhatsApp Web protocol) ──────────
  whatsapp: {
    // Directory where multi-file auth state (pairing credentials) is persisted.
    // Must be on a Docker volume so pairing survives container restarts.
    authDir: process.env.WA_AUTH_DIR || path.join(dataDir, 'wa-auth'),

    // If true (default), the bot starts automatically on boot. Set to "false"
    // to run the REST API without opening a WhatsApp socket (useful for tests).
    enabled: (process.env.WA_ENABLED ?? 'true').toLowerCase() !== 'false',

    // Group chat trigger word (must appear at the start of a group message
    // for the bot to respond). Case-insensitive. The "/" prefix also works.
    groupTrigger: process.env.WA_GROUP_TRIGGER || 'luna',

    // Mark incoming messages as read after processing.
    markRead: (process.env.WA_MARK_READ ?? 'true').toLowerCase() !== 'false',

    // Print the pairing QR to stdout on first run / re-pair.
    printQrInTerminal: (process.env.WA_PRINT_QR ?? 'true').toLowerCase() !== 'false',
  },

  // ─── OpenClaw (deprecated — kept for backward compat with existing webhook route) ───
  openclaw: {
    webhookSecret: process.env.OPENCLAW_WEBHOOK_SECRET || '',
    apiUrl: process.env.OPENCLAW_API_URL || '',
    apiKey: process.env.OPENCLAW_API_KEY || '',
    phoneNumberId: process.env.OPENCLAW_PHONE_NUMBER_ID || '',
    enabled: !!process.env.OPENCLAW_API_URL,
  },
};
