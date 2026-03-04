import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import fs from 'fs';
import * as Sentry from '@sentry/node';

dotenv.config();

// Initialize Sentry before anything else
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.2,
    sendDefaultPii: false,
  });
}

import { query } from './config/database';
import authRoutes from './routes/auth';
import groupRoutes from './routes/groups';
import challengeRoutes from './routes/challenges';
import uploadRoutes from './routes/upload';
import spotlightRoutes from './routes/spotlight';
import activityRoutes from './routes/activity';
import notificationRoutes from './routes/notifications';
import moderationRoutes from './routes/moderation';
import logger from './utils/logger';
import { RATE_LIMITS, OTP_RATE_LIMIT_PER_HOUR } from './utils/constants';
import { initSocket } from './socket';

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:8081', 'http://localhost:19006'],
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));

// ── Global rate limit ──────────────────────────────────────────
app.use(rateLimit({
  windowMs: RATE_LIMITS.GLOBAL.windowMs,
  max: RATE_LIMITS.GLOBAL.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
}));

// ── Per-route rate limits ──────────────────────────────────────
const otpLimiter = rateLimit({
  windowMs: RATE_LIMITS.OTP.windowMs,
  max: RATE_LIMITS.OTP.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests, please try again later' },
});

const uploadLimiter = rateLimit({
  windowMs: RATE_LIMITS.PHOTO_UPLOAD.windowMs,
  max: RATE_LIMITS.PHOTO_UPLOAD.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests, please try again later' },
});

const groupCreationLimiter = rateLimit({
  windowMs: RATE_LIMITS.GROUP_CREATION.windowMs,
  max: RATE_LIMITS.GROUP_CREATION.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many groups created, please try again later' },
});

// Apply per-route rate limits
app.use('/api/auth/request-otp', otpLimiter);
app.use('/api/upload', uploadLimiter);
app.post('/api/groups', groupCreationLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/spotlight', spotlightRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/moderation', moderationRoutes);

// ── Legal pages ──────────────────────────────────────────────
// Serve the legal HTML files at user-friendly URLs
// In dev (ts-node): __dirname = blink-server/src -> ../../legal = project root /legal
// In Docker production: __dirname = /app/dist -> ../legal = /app/legal
// We try both paths and use whichever exists
const legalCandidates = [
  path.resolve(__dirname, '../../legal'),   // dev: from src/ or dist/ in local monorepo
  path.resolve(__dirname, '../legal'),       // docker: from /app/dist -> /app/legal
];
const legalDir = legalCandidates.find(d => fs.existsSync(d)) || legalCandidates[0];

// Override helmet CSP for legal pages (they use inline <style> tags)
const legalCsp = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'";

app.get('/privacy', (_req, res) => {
  res.setHeader('Content-Security-Policy', legalCsp);
  res.sendFile(path.join(legalDir, 'privacy-policy.html'));
});

app.get('/terms', (_req, res) => {
  res.setHeader('Content-Security-Policy', legalCsp);
  res.sendFile(path.join(legalDir, 'terms-of-service.html'));
});

// API routes that redirect to the HTML pages (useful for programmatic access)
app.get('/api/legal/privacy', (_req, res) => {
  res.redirect('/privacy');
});

app.get('/api/legal/terms', (_req, res) => {
  res.redirect('/terms');
});

// Health check
app.get('/api/health', async (_req, res) => {
  const checks: Record<string, string> = { server: 'ok' };
  try {
    await query('SELECT 1');
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }
  const allOk = Object.values(checks).every(v => v === 'ok');
  res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', checks });
});

// Sentry error handler — must be before our custom error handler
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

const PORT = process.env.PORT || 3000;

// Create HTTP server and initialize Socket.io
const server = http.createServer(app);
export const io = initSocket(server);

server.listen(PORT, () => {
  logger.info(`Blink server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`OTP rate limit: ${OTP_RATE_LIMIT_PER_HOUR}/hour`);
  if (OTP_RATE_LIMIT_PER_HOUR > 10) {
    logger.warn(`OTP rate limit is set to ${OTP_RATE_LIMIT_PER_HOUR}/hour. This is above the recommended production value of 3. Ensure OTP_RATE_LIMIT_PER_HOUR is not set in production.`);
  }
});

// ── Graceful shutdown ─────────────────────────────────────────
function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    // Close Socket.io connections
    if (io) {
      io.close();
      logger.info('Socket.io server closed');
    }

    // Close database pool
    try {
      const pool = (await import('./config/database')).default;
      await pool.end();
      logger.info('Database pool closed');
    } catch (err: any) {
      logger.error('Error closing database pool', { error: err.message });
    }

    logger.info('Graceful shutdown complete');
    process.exit(0);
  });

  // Force exit after 30 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Graceful shutdown timed out after 30s, forcing exit');
    process.exit(1);
  }, 30_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
