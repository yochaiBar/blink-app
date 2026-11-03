import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../config/database';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import {
  requestOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  updateProfileSchema,
  pushTokenSchema,
} from '../utils/schemas';
import logger from '../utils/logger';
import { isSmsConfigured, sendSms } from '../config/sms';
import { env } from '../config/env';
import { UserRow } from '../types/db';
import { DEV_OTP, generateOtp, storeOtp, verifyOtp } from '../services/otp';
import { createSession, revokeSession, rotateRefreshToken } from '../services/authSessions';
import { disconnectUser } from '../socket';
import { handleAdminLeave } from '../services/groupService';

const router = Router();

// The fixed dev code is only ever possible outside production, and only
// without Twilio (or when Twilio fails and the fallback is opted into).
// In production the env schema refuses to boot without Twilio.
const DEV_OTP_ALLOWED = env.NODE_ENV !== 'production';
const ALLOW_DEV_OTP_FALLBACK = DEV_OTP_ALLOWED && env.ALLOW_DEV_OTP_FALLBACK === 'true';

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);
}

function isAppReviewPhone(phone: string): boolean {
  return !!env.APP_REVIEW_PHONE && !!env.APP_REVIEW_OTP && phone === env.APP_REVIEW_PHONE;
}

// ── POST /api/auth/request-otp ───────────────────────────────────
router.post(
  '/request-otp',
  validateBody(requestOtpSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { phone_number } = req.body;

    if (isAppReviewPhone(phone_number)) {
      // App Store review account: fixed code from env, no SMS.
      await storeOtp(phone_number, env.APP_REVIEW_OTP as string);
      logger.info('OTP requested (app review phone)', { phone: maskPhone(phone_number) });
      res.json({ message: 'OTP sent' });
      return;
    }

    if (!isSmsConfigured) {
      if (!DEV_OTP_ALLOWED) {
        // Unreachable when the env schema is enforced; never fall back silently.
        throw new Error('SMS is not configured');
      }
      // Dev / test: predictable OTP, no SMS sent.
      await storeOtp(phone_number, DEV_OTP);
      logger.info('OTP requested (dev mode)', { phone: maskPhone(phone_number) });
      res.json({ message: 'OTP sent', dev_hint: `Use ${DEV_OTP}` });
      return;
    }

    const code = generateOtp();
    await storeOtp(phone_number, code);

    try {
      await sendSms(phone_number, `Your Blinks verification code is: ${code}`);
      logger.info('OTP sent via Twilio', { phone: maskPhone(phone_number) });
    } catch (err) {
      if (!ALLOW_DEV_OTP_FALLBACK) throw err;
      logger.warn('Twilio SMS failed, falling back to dev OTP', {
        phone: maskPhone(phone_number),
        error: (err as Error).message,
      });
      await storeOtp(phone_number, DEV_OTP);
    }

    res.json({ message: 'OTP sent' });
  }),
);

// ── POST /api/auth/verify-otp ────────────────────────────────────
router.post(
  '/verify-otp',
  validateBody(verifyOtpSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { phone_number, code } = req.body;

    const check = await verifyOtp(phone_number, code);
    if (check === 'locked') {
      res.status(429).json({ error: 'Too many attempts. Please request a new code.' });
      return;
    }
    if (check !== 'ok') {
      res.status(401).json({ error: 'Invalid or expired OTP' });
      return;
    }

    logger.info('OTP verified', { phone: maskPhone(phone_number) });

    const result = await query<Pick<UserRow, 'id' | 'phone_number' | 'display_name' | 'bio'>>(
      `INSERT INTO users (phone_number) VALUES ($1)
       ON CONFLICT (phone_number) DO UPDATE SET last_active_at = NOW()
       RETURNING id, phone_number, display_name, bio`,
      [phone_number],
    );
    const user = result.rows[0];
    const tokens = await createSession(user.id);

    logger.info('User authenticated', { userId: user.id });
    res.json({ user, ...tokens });
  }),
);

// ── POST /api/auth/refresh ───────────────────────────────────────
router.post(
  '/refresh',
  validateBody(refreshTokenSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const outcome = await rotateRefreshToken(req.body.refresh_token);
    if (!outcome.ok) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }
    res.json(outcome.tokens);
  }),
);

// ── POST /api/auth/logout ────────────────────────────────────────
// Ends this device's session: its refresh token stops working and its
// sockets are disconnected. Other devices stay signed in.
router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await revokeSession(req.sessionId as string, 'logout');
    res.json({ message: 'Logged out' });
  }),
);

// ── GET /api/auth/me ─────────────────────────────────────────────
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await query<UserRow>(
      `SELECT id, phone_number, display_name, bio, created_at, last_active_at
       FROM users WHERE id = $1`,
      [req.userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(result.rows[0]);
  }),
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
      [req.userId],
    );

    res.json(result.rows[0]);
  }),
);

// ── PATCH /api/auth/profile ──────────────────────────────────────
router.patch(
  '/profile',
  authenticate,
  validateBody(updateProfileSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { display_name, bio } = req.body;

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (display_name !== undefined) {
      setClauses.push(`display_name = $${paramIndex++}`);
      values.push(display_name);
    }
    if (bio !== undefined) {
      setClauses.push(`bio = $${paramIndex++}`);
      values.push(bio || null);
    }

    values.push(req.userId);

    const result = await query<UserRow>(
      `UPDATE users SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, phone_number, display_name, bio, created_at, last_active_at`,
      values,
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    logger.info('Profile updated', { userId: req.userId });
    res.json(result.rows[0]);
  }),
);

// ── POST /api/auth/push-token ────────────────────────────────────
router.post(
  '/push-token',
  authenticate,
  validateBody(pushTokenSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { push_token } = req.body;

    await query(`UPDATE users SET push_token = $1 WHERE id = $2`, [push_token, req.userId]);

    logger.info('Push token saved', { userId: req.userId });
    res.json({ message: 'Push token saved' });
  }),
);

// ── DELETE /api/auth/delete-account ──────────────────────────────
router.delete(
  '/delete-account',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // Sessions go with the user (ON DELETE CASCADE), so every access token
    // and refresh token stops working at once. Groups the user administers
    // are handed over first (or deleted, if the user was the last member).
    const deleted = await withTransaction(async (client) => {
      const adminOf = await client.query<{ group_id: string }>(
        `SELECT group_id FROM group_members WHERE user_id = $1 AND role = 'admin'`,
        [req.userId],
      );
      for (const { group_id } of adminOf.rows) {
        await handleAdminLeave(client, group_id, req.userId as string);
      }
      await client.query(`DELETE FROM group_members WHERE user_id = $1`, [req.userId]);
      const result = await client.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [req.userId]);
      return result.rows.length > 0;
    });
    if (!deleted) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    disconnectUser(req.userId as string);
    logger.info('Account deleted', { userId: req.userId });
    res.json({ message: 'Account deleted successfully' });
  }),
);

export default router;
