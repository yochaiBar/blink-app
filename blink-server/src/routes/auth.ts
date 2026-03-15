import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query, withTransaction } from '../config/database';
import { JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY } from '../utils/constants';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { requestOtpSchema, verifyOtpSchema, refreshTokenSchema, updateProfileSchema, pushTokenSchema } from '../utils/schemas';
import logger from '../utils/logger';
import { isSmsConfigured, sendSms } from '../config/sms';
import { env } from '../config/env';
import { UserRow } from '../types/db';
import type { QueryResult } from 'pg';

/** Minimal query interface compatible with both PoolClient and the pool query helper */
interface TransactionQueryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, params?: unknown[]): Promise<QueryResult<any>>;
}

const router = Router();

const DEV_OTP = '123456';
const ALLOW_DEV_OTP_FALLBACK = env.NODE_ENV !== 'production' && env.ALLOW_DEV_OTP_FALLBACK === 'true';

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);
}

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

// ── OTP persistence (PostgreSQL + write-through in-process cache) ─
// The in-process Map acts as a write-through cache so that OTPs are
// available even when the database is mocked (tests) or momentarily
// unreachable.  The database is the durable source of truth; the cache
// is a convenience for the common single-instance deployment.
const otpCache = new Map<string, { code: string; expiresAt: number; attempts: number }>();

async function storeOtp(phone: string, code: string): Promise<void> {
  const expiresAt = Date.now() + 5 * 60 * 1000;
  // Clean up expired OTPs and any existing OTP for this phone
  await query('DELETE FROM otp_codes WHERE phone = $1 OR expires_at < NOW()', [phone]);
  await query(
    'INSERT INTO otp_codes (phone, code, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'5 minutes\')',
    [phone, code]
  );
  otpCache.set(phone, { code, expiresAt, attempts: 0 });
}

async function getOtp(phone: string): Promise<{ code: string; attempts: number } | null> {
  // Check in-process cache first (fast path, always populated by storeOtp)
  const cached = otpCache.get(phone);
  if (cached && Date.now() <= cached.expiresAt) {
    return { code: cached.code, attempts: cached.attempts };
  }
  if (cached) otpCache.delete(phone);

  // Fall back to database (handles multi-instance or post-restart scenarios)
  const result = await query<{ code: string; attempts: number }>(
    'SELECT code, attempts FROM otp_codes WHERE phone = $1 AND expires_at > NOW() LIMIT 1',
    [phone]
  );
  const row = result.rows[0];
  if (row && typeof row.code === 'string') return row;
  return null;
}

async function incrementOtpAttempts(phone: string): Promise<void> {
  await query(
    'UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1 AND expires_at > NOW()',
    [phone]
  );
  const cached = otpCache.get(phone);
  if (cached) cached.attempts++;
}

async function deleteOtp(phone: string): Promise<void> {
  await query('DELETE FROM otp_codes WHERE phone = $1', [phone]);
  otpCache.delete(phone);
}

// ── POST /api/auth/request-otp ───────────────────────────────────
router.post(
  '/request-otp',
  validateBody(requestOtpSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { phone_number } = req.body;

    if (!isSmsConfigured) {
      // Dev mode: predictable OTP
      await storeOtp(phone_number, DEV_OTP);
      logger.info('OTP requested (dev mode)', { phone: maskPhone(phone_number) });
      res.json({
        message: 'OTP sent',
        ...(env.NODE_ENV !== 'production' && { dev_hint: 'Use 123456' }),
      });
      return;
    }

    // Production: generate real OTP, store it, send via Twilio
    const code = generateOtp();
    await storeOtp(phone_number, code);

    try {
      await sendSms(phone_number, `Your Blinks verification code is: ${code}`);
      logger.info('OTP sent via Twilio', { phone: maskPhone(phone_number) });
    } catch (err) {
      if (ALLOW_DEV_OTP_FALLBACK) {
        logger.warn('Twilio SMS failed, falling back to dev OTP', { phone: maskPhone(phone_number), error: (err as Error).message });
        await storeOtp(phone_number, DEV_OTP);
      } else {
        throw err;
      }
    }

    res.json({ message: 'OTP sent' });
  })
);

// ── POST /api/auth/verify-otp ────────────────────────────────────
router.post(
  '/verify-otp',
  validateBody(verifyOtpSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { phone_number, code } = req.body;

    const pending = await getOtp(phone_number);
    if (!pending) {
      res.status(401).json({ error: 'Invalid or expired OTP' });
      return;
    }

    // Per-phone attempt lockout
    if (pending.attempts >= 5) {
      deleteOtp(phone_number).catch(() => {});
      res.status(429).json({ error: 'Too many attempts. Please request a new code.' });
      return;
    }

    // Timing-safe comparison to prevent timing attacks
    const codeBuffer = Buffer.from(code.padEnd(6), 'utf8');
    const pendingBuffer = Buffer.from(pending.code.padEnd(6), 'utf8');
    const codesMatch = crypto.timingSafeEqual(codeBuffer, pendingBuffer);

    if (!codesMatch) {
      incrementOtpAttempts(phone_number).catch(() => {});
      res.status(401).json({ error: 'Invalid or expired OTP' });
      return;
    }

    logger.info('OTP verified', { phone: maskPhone(phone_number) });

    // ── Upsert user ──────────────────────────────────────────────
    const result = await query<Pick<UserRow, 'id' | 'phone_number' | 'display_name' | 'avatar_url' | 'bio'>>(
      `INSERT INTO users (phone_number) VALUES ($1)
       ON CONFLICT (phone_number) DO UPDATE SET last_active_at = NOW()
       RETURNING id, phone_number, display_name, avatar_url, bio`,
      [phone_number]
    );
    const user = result.rows[0];

    // Clean up consumed OTP after successful authentication
    deleteOtp(phone_number).catch(() => {});

    // ── Issue JWT tokens ─────────────────────────────────────────
    const accessToken = jwt.sign(
      { userId: user.id },
      env.JWT_SECRET,
      { expiresIn: JWT_ACCESS_EXPIRY }
    );
    const refreshToken = jwt.sign(
      { userId: user.id },
      env.JWT_REFRESH_SECRET,
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
        env.JWT_REFRESH_SECRET
      ) as { userId: string };

      const newAccessToken = jwt.sign(
        { userId: payload.userId },
        env.JWT_SECRET,
        { expiresIn: JWT_ACCESS_EXPIRY }
      );
      const newRefreshToken = jwt.sign(
        { userId: payload.userId },
        env.JWT_REFRESH_SECRET,
        { expiresIn: JWT_REFRESH_EXPIRY }
      );

      logger.info('Token refreshed', { userId: payload.userId });
      res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
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
    const result = await query<UserRow>(
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
    const values: unknown[] = [];
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

    const result = await query<UserRow>(
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
    const deleteAccountQueries = async (q: TransactionQueryable) => {
      // Revoke all tokens for this user before deletion
      await q.query('INSERT INTO revoked_tokens (user_id) VALUES ($1)', [req.userId]);

      await q.query(`DELETE FROM group_members WHERE user_id = $1`, [req.userId]);

      const result = await q.query(
        `DELETE FROM users WHERE id = $1 RETURNING id`,
        [req.userId]
      );

      return result.rows.length > 0;
    };

    const deleted = typeof withTransaction === 'function'
      ? await withTransaction(deleteAccountQueries)
      : await deleteAccountQueries({ query });

    if (!deleted) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    logger.info('Account deleted', { userId: req.userId });
    res.json({ message: 'Account deleted successfully' });
  })
);

export default router;
