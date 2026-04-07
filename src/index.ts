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
import { expireOldPasses } from './modules/visitor-passes';

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
  res.json({
    status: 'ok',
    service: 'gate-concierge',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    openclaw: config.openclaw.enabled ? 'configured' : 'not configured',
  });
});

// API routes (protected)
app.use('/api', adminAuth, apiRouter);

// Admin dashboard (protected)
app.use('/admin', adminAuth, adminRouter);

// OpenClaw webhook (loaded only when configured)
if (config.openclaw.enabled) {
  import('./routes/webhook').then(({ default: webhookRouter }) => {
    app.use('/', webhookRouter);
    logger.info('OpenClaw webhook enabled');
  });
} else {
  logger.info('OpenClaw not configured — webhook disabled. Set OPENCLAW_API_URL to enable.');
}

// Initialize database
initializeDatabase();

// Expire old passes every 5 minutes
setInterval(() => {
  const expired = expireOldPasses();
  if (expired > 0) logger.info(`Expired ${expired} old passes`);
}, 5 * 60 * 1000);

// Start server
app.listen(config.port, '0.0.0.0', () => {
  logger.info(`Gate Concierge running on port ${config.port} (${config.nodeEnv})`);
  logger.info(`Health:    http://localhost:${config.port}/health`);
  logger.info(`API:       http://localhost:${config.port}/api`);
  logger.info(`Dashboard: http://localhost:${config.port}/admin`);
});

export default app;
