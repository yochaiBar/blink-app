export const JWT_ACCESS_EXPIRY = '15m';

import { env } from '../config/env';

// OTP rate limit: defaults to 3/hour in production.
// Override via OTP_RATE_LIMIT_PER_HOUR env var for development/testing.
export const OTP_RATE_LIMIT_PER_HOUR = env.OTP_RATE_LIMIT_PER_HOUR ?? 3;

export const RATE_LIMITS = {
  GLOBAL: { windowMs: 60 * 1000, max: 100 },
  OTP: { windowMs: 60 * 60 * 1000, max: OTP_RATE_LIMIT_PER_HOUR },
  GROUP_CREATION: { windowMs: 24 * 60 * 60 * 1000, max: 5 },
};
