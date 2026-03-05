import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../config/database';
import { JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY } from '../utils/constants';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { requestOtpSchema, verifyOtpSchema, refreshTokenSchema, updateProfileSchema, pushTokenSchema } from '../utils/schemas';
import logger from '../utils/logger';
import { isSmsConfigured, sendSms } from '../config/sms';

const router = Router();

const DEV_OTP = '123456';

// In-memory OTP store (phone -> { code, expiresAt })
const pendingOtps = new Map<string, { code: string; expiresAt: number }>();

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

// ── POST /api/auth/request-otp ───────────────────────────────────
router.post(
  '/request-otp',
  validateBody(requestOtpSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { phone_number } = req.body;

    if (!isSmsConfigured) {
      // Dev mode: predictable OTP
      pendingOtps.set(phone_number, {
        code: DEV_OTP,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      logger.info('OTP requested (dev mode)', { phone_number });
      res.json({
        message: 'OTP sent',
        ...(process.env.NODE_ENV !== 'production' && { dev_hint: 'Use 123456' }),
      });
      return;
    }

    // Production: generate real OTP, store it, send via Twilio
    const code = generateOtp();
    pendingOtps.set(phone_number, {
      code,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    await sendSms(phone_number, `Your Blinks verification code is: ${code}`);

    logger.info('OTP sent via Twilio', { phone_number });
    res.json({ message: 'OTP sent' });
  })
);

// ── POST /api/auth/verify-otp ────────────────────────────────────
router.post(
  '/verify-otp',
  validateBody(verifyOtpSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { phone_number, code } = req.body;

    const pending = pendingOtps.get(phone_number);
    if (!pending || pending.code !== code || Date.now() > pending.expiresAt) {
      res.status(401).json({ error: 'Invalid or expired OTP' });
      return;
    }
    pendingOtps.delete(phone_number);
    logger.info('OTP verified', { phone_number });

    // ── Upsert user ──────────────────────────────────────────────
    const result = await query(
      `INSERT INTO users (phone_number) VALUES ($1)
       ON CONFLICT (phone_number) DO UPDATE SET last_active_at = NOW()
       RETURNING id, phone_number, display_name, avatar_url, bio`,
      [phone_number]
    );
    const user = result.rows[0];

    // ── Issue JWT tokens ─────────────────────────────────────────
    const accessToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET!,
      { expiresIn: JWT_ACCESS_EXPIRY }
    );
    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: JWT_REFRESH_EXPIRY }
    );

    logger.info('User authenticated', { userId: user.id });
    res.json({ user, accessToken, refreshToken });
  })
);

// ── POST /api/auth/refresh ───────────────────────────────────────
router.post(
  '/refresh',
  validateBody(refreshTokenSchema),
  (req: Request, res: Response) => {
    const { refreshToken } = req.body;

    try {
      const payload = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET!
      ) as { userId: string };

      const accessToken = jwt.sign(
        { userId: payload.userId },
        process.env.JWT_SECRET!,
        { expiresIn: JWT_ACCESS_EXPIRY }
      );

      logger.info('Token refreshed', { userId: payload.userId });
      res.json({ accessToken });
    } catch {
      res.status(401).json({ error: 'Invalid refresh token' });
    }
  }
);

// ── GET /api/auth/me ─────────────────────────────────────────────
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await query(
      `SELECT id, phone_number, display_name, avatar_url, bio, created_at, last_active_at
       FROM users WHERE id = $1`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(result.rows[0]);
  })
);

// ── GET /api/auth/stats ──────────────────────────────────────────
router.get(
  '/stats',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await query(
      `SELECT
         COALESCE(SUM(total_responses), 0)::int AS total_snaps,
         COALESCE(MAX(current_streak), 0)::int AS longest_streak,
         COUNT(*)::int AS group_count
       FROM group_members
       WHERE user_id = $1`,
      [req.userId]
    );

    res.json(result.rows[0]);
  })
);

// ── PATCH /api/auth/profile ──────────────────────────────────────
router.patch(
  '/profile',
  authenticate,
  validateBody(updateProfileSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { display_name, avatar_url, bio } = req.body;

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (display_name !== undefined) {
      setClauses.push(`display_name = $${paramIndex++}`);
      values.push(display_name);
    }
    if (avatar_url !== undefined) {
      setClauses.push(`avatar_url = $${paramIndex++}`);
      values.push(avatar_url || null);
    }
    if (bio !== undefined) {
      setClauses.push(`bio = $${paramIndex++}`);
      values.push(bio || null);
    }

    values.push(req.userId);

    const result = await query(
      `UPDATE users SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, phone_number, display_name, avatar_url, bio, created_at, last_active_at`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    logger.info('Profile updated', { userId: req.userId });
    res.json(result.rows[0]);
  })
);

// ── POST /api/auth/push-token ────────────────────────────────────
router.post(
  '/push-token',
  authenticate,
  validateBody(pushTokenSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { push_token } = req.body;

    await query(
      `UPDATE users SET push_token = $1 WHERE id = $2`,
      [push_token, req.userId]
    );

    logger.info('Push token saved', { userId: req.userId });
    res.json({ message: 'Push token saved' });
  })
);

// ── DELETE /api/auth/delete-account ──────────────────────────────
router.delete(
  '/delete-account',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await query(`DELETE FROM group_members WHERE user_id = $1`, [req.userId]);

    const result = await query(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    logger.info('Account deleted', { userId: req.userId });
    res.json({ message: 'Account deleted successfully' });
  })
);

export default router;
