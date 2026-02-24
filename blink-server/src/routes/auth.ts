import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY } from '../utils/constants';

const router = Router();

// In dev mode, we skip Firebase OTP and accept any 6-digit code.
// This lets us test the full flow without Firebase credentials.
const DEV_MODE = process.env.NODE_ENV === 'development';
const DEV_OTP = '123456';

// Store pending OTPs in memory (dev only)
const pendingOtps = new Map<string, { code: string; expiresAt: number }>();

// POST /api/auth/request-otp
router.post('/request-otp', (req: Request, res: Response) => {
  const { phone_number } = req.body;
  if (!phone_number) {
    res.status(400).json({ error: 'phone_number is required' });
    return;
  }

  if (DEV_MODE) {
    pendingOtps.set(phone_number, {
      code: DEV_OTP,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    res.json({ message: 'OTP sent', dev_hint: 'Use 123456' });
    return;
  }

  // TODO: Firebase OTP for production
  res.json({ message: 'OTP sent' });
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req: Request, res: Response) => {
  const { phone_number, code } = req.body;
  if (!phone_number || !code) {
    res.status(400).json({ error: 'phone_number and code are required' });
    return;
  }

  if (DEV_MODE) {
    const pending = pendingOtps.get(phone_number);
    if (!pending || pending.code !== code || Date.now() > pending.expiresAt) {
      res.status(401).json({ error: 'Invalid or expired OTP' });
      return;
    }
    pendingOtps.delete(phone_number);
  }

  // Upsert user
  const result = await query(
    `INSERT INTO users (phone_number) VALUES ($1)
     ON CONFLICT (phone_number) DO UPDATE SET last_active_at = NOW()
     RETURNING id, phone_number, display_name, avatar_url`,
    [phone_number]
  );
  const user = result.rows[0];

  const accessToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
    expiresIn: JWT_ACCESS_EXPIRY,
  });
  const refreshToken = jwt.sign({ userId: user.id }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: JWT_REFRESH_EXPIRY,
  });

  res.json({ user, accessToken, refreshToken });
});

// POST /api/auth/refresh
router.post('/refresh', (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken is required' });
    return;
  }

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { userId: string };
    const accessToken = jwt.sign({ userId: payload.userId }, process.env.JWT_SECRET!, {
      expiresIn: JWT_ACCESS_EXPIRY,
    });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

export default router;
