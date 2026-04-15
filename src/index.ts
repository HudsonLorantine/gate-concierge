import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './config';
import { initializeDatabase } from './database/db';
import { logger } from './utils/logger';
import { adminAuth } from './middleware/auth';
import apiRouter from './routes/api';
import adminRouter from './routes/admin';
import whatsappRouter from './routes/whatsapp';
import { expireOldPasses } from './modules/visitor-passes';
import { startWhatsApp, stopWhatsApp, getWhatsAppStatus } from './services/whatsapp';

const app = express();

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

// Health check (public — no auth)
app.get('/health', (_req, res) => {
  const wa = getWhatsAppStatus();
  res.json({
    status: 'ok',
    service: 'gate-concierge',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
    whatsapp: {
      enabled: config.whatsapp.enabled,
      state: wa.state,
      pairedNumber: wa.pairedNumber,
    },
  });
});

// API routes (protected)
app.use('/api', adminAuth, apiRouter);

// WhatsApp admin routes (protected) — status / QR / logout
app.use('/api/whatsapp', adminAuth, whatsappRouter);

// Admin dashboard (protected)
app.use('/admin', adminAuth, adminRouter);

// Optional legacy OpenClaw webhook (disabled by default; kept for backward compat)
if (config.openclaw.enabled) {
  import('./routes/webhook').then(({ default: webhookRouter }) => {
    app.use('/', webhookRouter);
    logger.info('Legacy OpenClaw webhook mounted (OPENCLAW_API_URL is set)');
  });
}

// Initialize database
initializeDatabase();

// Expire old passes every 5 minutes
setInterval(() => {
  const expired = expireOldPasses();
  if (expired > 0) logger.info(`Expired ${expired} old passes`);
}, 5 * 60 * 1000);

// Start WhatsApp (Baileys) socket
if (config.whatsapp.enabled) {
  startWhatsApp().catch((err) => {
    logger.error('WhatsApp socket failed to start', { err: err?.message ?? err });
  });
} else {
  logger.info('WhatsApp disabled (WA_ENABLED=false) — REST API only');
}

// Start HTTP server
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info(`Gate Concierge running on port ${config.port} (${config.nodeEnv})`);
  logger.info(`Health:    http://localhost:${config.port}/health`);
  logger.info(`API:       http://localhost:${config.port}/api`);
  logger.info(`Dashboard: http://localhost:${config.port}/admin`);
});

// Graceful shutdown — let Baileys close its socket cleanly so auth state is saved
function shutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down`);
  server.close(() => {
    stopWhatsApp()
      .catch((err) => logger.error('Error stopping WhatsApp', { err }))
      .finally(() => process.exit(0));
  });
  // Hard-fail after 10s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
