import path from 'path';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    path: process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'gate-concierge.db'),
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

  // OpenClaw / WhatsApp — optional, for future integration
  openclaw: {
    webhookSecret: process.env.OPENCLAW_WEBHOOK_SECRET || '',
    apiUrl: process.env.OPENCLAW_API_URL || '',
    apiKey: process.env.OPENCLAW_API_KEY || '',
    phoneNumberId: process.env.OPENCLAW_PHONE_NUMBER_ID || '',
    enabled: !!process.env.OPENCLAW_API_URL,
  },
};
