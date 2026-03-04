export const JWT_ACCESS_EXPIRY = '15m';
export const JWT_REFRESH_EXPIRY = '7d';
export const OTP_EXPIRY_MINUTES = 5;
export const MAX_GROUP_MEMBERS = 15;
export const CHALLENGE_COUNTDOWN_SECONDS = 10;
export const PHOTO_EXPIRY_HOURS = 24;
export const PRESIGNED_URL_EXPIRY_SECONDS = 300;
export const DEFAULT_QUIET_HOURS_START = '22:00';
export const DEFAULT_QUIET_HOURS_END = '08:00';

// OTP rate limit: defaults to 3/hour in production.
// Override via OTP_RATE_LIMIT_PER_HOUR env var for development/testing.
const OTP_RATE_LIMIT_DEFAULT = 3;
const otpRateLimit = parseInt(process.env.OTP_RATE_LIMIT_PER_HOUR || '', 10);
export const OTP_RATE_LIMIT_PER_HOUR = Number.isFinite(otpRateLimit) && otpRateLimit > 0
  ? otpRateLimit
  : OTP_RATE_LIMIT_DEFAULT;

export const RATE_LIMITS = {
  GLOBAL: { windowMs: 60 * 1000, max: 100 },
  PHOTO_UPLOAD: { windowMs: 60 * 1000, max: 10 },
  OTP: { windowMs: 60 * 60 * 1000, max: OTP_RATE_LIMIT_PER_HOUR },
  GROUP_CREATION: { windowMs: 24 * 60 * 60 * 1000, max: 5 },
};
