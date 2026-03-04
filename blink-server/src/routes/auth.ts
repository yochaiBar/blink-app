import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY } from '../utils/constants';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { requestOtpSchema, verifyOtpSchema, refreshTokenSchema, updateProfileSchema, pushTokenSchema } from '../utils/schemas';
import logger from '../utils/logger';
import { isFirebaseConfigured, verifyFirebaseToken } from '../config/firebase';

const router = Router();

// ── Dev mode fallback ────────────────────────────────────────────
// When Firebase is not configured (no FIREBASE_SERVICE_ACCOUNT env var),
// the server falls back to a dev-mode OTP flow where the code is always
// 123456. This lets developers test the full auth flow locally without
// needing Firebase credentials.
const DEV_OTP = '123456';

// In-memory store for dev-mode OTPs
const pendingOtps = new Map<string, { code: string; expiresAt: number }>();

// ── POST /api/auth/request-otp ───────────────────────────────────
// In production (Firebase configured), this endpoint is a no-op because
// Firebase Phone Auth handles OTP delivery entirely on the client side.
// In dev mode, it stores a pending OTP of 123456 for the phone number.
router.post(
  '/request-otp',
  validateBody(requestOtpSchema),
  (req: Request, res: Response) => {
    const { phone_number } = req.body;

    if (!isFirebaseConfigured) {
      // Dev mode: store a predictable OTP
      pendingOtps.set(phone_number, {
        code: DEV_OTP,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      logger.info('OTP requested (dev mode)', { phone_number });
      res.json({
        message: 'OTP sent',
        verificationId: 'dev-mode',
        dev_hint: 'Use 123456',
      });
      return;
    }

    // Production: OTP is sent by Firebase client SDK, server has nothing to do.
    logger.info('OTP request acknowledged (Firebase handles delivery)', {
      phone_number,
    });
    res.json({
      message: 'Use Firebase client SDK to request OTP',
      verificationId: 'firebase-client-side',
    });
  }
);

// ── POST /api/auth/verify-otp ────────────────────────────────────
// Two flows:
//
// 1. Dev mode (Firebase not configured):
//    Body: { phone_number: "+1...", code: "123456" }
//    Verifies code against the in-memory pendingOtps map.
//
// 2. Production (Firebase configured):
//    Body: { firebaseToken: "<Firebase ID token>" }
//    The client has already completed Firebase Phone Auth and received
//    an ID token. The server verifies the token with Firebase Admin SDK
//    and extracts the phone number from the token claims.
router.post(
  '/verify-otp',
  validateBody(verifyOtpSchema),
  asyncHandler(async (req: Request, res: Response) => {
    let phoneNumber: string;

    const { firebaseToken, phone_number, code } = req.body;

    if (firebaseToken && isFirebaseConfigured) {
      // ── Firebase flow ────────────────────────────────────────
      try {
        const decodedToken = await verifyFirebaseToken(firebaseToken);

        if (!decodedToken.phone_number) {
          logger.warn('Firebase token missing phone_number claim', {
            uid: decodedToken.uid,
          });
          res.status(401).json({
            error: 'Firebase token does not contain a phone number',
          });
          return;
        }

        phoneNumber = decodedToken.phone_number;
        logger.info('Firebase token verified', {
          firebaseUid: decodedToken.uid,
          phone_number: phoneNumber,
        });
      } catch (err: any) {
        logger.warn('Firebase token verification failed', {
          error: err.message,
        });
        res.status(401).json({ error: 'Invalid or expired Firebase token' });
        return;
      }
    } else if (!isFirebaseConfigured && phone_number && code) {
      // ── Dev mode flow ────────────────────────────────────────
      const pending = pendingOtps.get(phone_number);
      if (!pending || pending.code !== code || Date.now() > pending.expiresAt) {
        res.status(401).json({ error: 'Invalid or expired OTP' });
        return;
      }
      pendingOtps.delete(phone_number);
      phoneNumber = phone_number;
      logger.info('OTP verified (dev mode)', { phone_number });
    } else if (isFirebaseConfigured && !firebaseToken) {
      // Firebase is configured but client sent dev-mode fields
      res.status(400).json({
        error:
          'Firebase is configured. Send { firebaseToken } instead of phone_number/code.',
      });
      return;
    } else {
      res.status(400).json({
        error:
          'Invalid request. Provide firebaseToken (production) or phone_number + code (dev mode).',
      });
      return;
    }

    // ── Upsert user ──────────────────────────────────────────────
    const result = await query(
      `INSERT INTO users (phone_number) VALUES ($1)
       ON CONFLICT (phone_number) DO UPDATE SET last_active_at = NOW()
       RETURNING id, phone_number, display_name, avatar_url, bio`,
      [phoneNumber]
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

// ── POST /api/auth/push-token — Save Expo push token ────────
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
    // Remove from all groups
    await query(`DELETE FROM group_members WHERE user_id = $1`, [req.userId]);

    // Delete the user record (CASCADE will handle challenge_responses,
    // daily_spotlights, active_penalties)
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
