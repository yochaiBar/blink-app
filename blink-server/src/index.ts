import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

import authRoutes from './routes/auth';
import groupRoutes from './routes/groups';
import challengeRoutes from './routes/challenges';
import uploadRoutes from './routes/upload';
import spotlightRoutes from './routes/spotlight';
import logger from './utils/logger';
import { RATE_LIMITS } from './utils/constants';

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:8081', 'http://localhost:19006'],
  credentials: true,
}));
app.use(morgan('dev'));
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

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Blink server running on port ${PORT}`);
});

export default app;
