/**
 * One-time login codes, stored only as HMAC(OTP_PEPPER, phone:code).
 *
 * One live code per phone (requesting again replaces it). Verification
 * spends an attempt atomically before comparing, so concurrent guesses can't
 * exceed MAX_OTP_ATTEMPTS, and a correct code is consumed with
 * DELETE ... RETURNING, so it can be used exactly once.
 */
import crypto from 'crypto';
import { query } from '../config/database';
import { env } from '../config/env';

export const MAX_OTP_ATTEMPTS = 5;
const OTP_TTL = "INTERVAL '5 minutes'";

export const DEV_OTP = '123456';

// Outside production a fixed pepper keeps local setups zero-config; the env
// schema makes OTP_PEPPER mandatory in production.
const pepper = env.OTP_PEPPER || 'blink-dev-otp-pepper';

function hashCode(phone: string, code: string): string {
  return crypto.createHmac('sha256', pepper).update(`${phone}:${code}`).digest('hex');
}

export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/** Store `code` as the live code for `phone`, replacing any previous one. */
export async function storeOtp(phone: string, code: string): Promise<void> {
  await query(`DELETE FROM otp_codes WHERE expires_at < NOW()`);
  await query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at)
     VALUES ($1, $2, NOW() + ${OTP_TTL})
     ON CONFLICT (phone) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, attempts = 0, created_at = NOW(), expires_at = EXCLUDED.expires_at`,
    [phone, hashCode(phone, code)],
  );
}

export type OtpCheck = 'ok' | 'invalid' | 'locked';

/** Check `code` for `phone`; a correct code is consumed. */
export async function verifyOtp(phone: string, code: string): Promise<OtpCheck> {
  const spent = await query<{ code_hash: string }>(
    `UPDATE otp_codes SET attempts = attempts + 1
      WHERE phone = $1 AND expires_at > NOW() AND attempts < $2
      RETURNING code_hash`,
    [phone, MAX_OTP_ATTEMPTS],
  );
  if (spent.rows.length === 0) {
    const locked = await query(`SELECT 1 FROM otp_codes WHERE phone = $1 AND expires_at > NOW()`, [phone]);
    return locked.rows.length > 0 ? 'locked' : 'invalid';
  }

  const expected = Buffer.from(spent.rows[0].code_hash, 'hex');
  const actual = Buffer.from(hashCode(phone, code), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return 'invalid';
  }

  // Consume: only one concurrent verify with the right code can win.
  const consumed = await query(`DELETE FROM otp_codes WHERE phone = $1 AND code_hash = $2 RETURNING 1`, [
    phone,
    spent.rows[0].code_hash,
  ]);
  return consumed.rows.length > 0 ? 'ok' : 'invalid';
}
