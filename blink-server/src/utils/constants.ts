export const JWT_ACCESS_EXPIRY = '15m';

// OTP rate limit: defaults to 3/hour in production.
// Override via OTP_RATE_LIMIT_PER_HOUR env var for development/testing.
const OTP_RATE_LIMIT_DEFAULT = 3;
const otpRateLimit = parseInt(process.env.OTP_RATE_LIMIT_PER_HOUR || '', 10);
export const OTP_RATE_LIMIT_PER_HOUR =
  Number.isFinite(otpRateLimit) && otpRateLimit > 0 ? otpRateLimit : OTP_RATE_LIMIT_DEFAULT;

export const RATE_LIMITS = {
  GLOBAL: { windowMs: 60 * 1000, max: 100 },
  OTP: { windowMs: 60 * 60 * 1000, max: OTP_RATE_LIMIT_PER_HOUR },
  GROUP_CREATION: { windowMs: 24 * 60 * 60 * 1000, max: 5 },
};
