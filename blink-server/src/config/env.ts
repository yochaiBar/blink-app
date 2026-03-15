import { z } from 'zod';

/**
 * Zod-validated environment configuration.
 *
 * This module parses `process.env` at import time. Because the test setup
 * (`__tests__/setup.ts`) assigns all required env vars before any source
 * imports, the eager parse is safe for both production and test environments.
 */

const envSchema = z.object({
  // ── Required ────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // ── Defaults ────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().nonnegative().default(3000),

  // ── Optional flags ──────────────────────────────────────────────
  ALLOW_DEV_OTP_FALLBACK: z.string().optional(),
  OTP_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().optional(),

  // ── Twilio ──────────────────────────────────────────────────────
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // ── AWS S3 ──────────────────────────────────────────────────────
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),

  // ── Observability ───────────────────────────────────────────────
  SENTRY_DSN: z.string().optional(),
  EXPO_PUBLIC_SENTRY_DSN: z.string().optional(),

  // ── Database extras (used by database.ts pool config) ───────────
  DB_POOL_MAX: z.string().optional(),
  DB_SSL_REJECT_UNAUTHORIZED: z.string().optional(),
  DB_SSL_CERT: z.string().optional(),

  // ── CORS ────────────────────────────────────────────────────────
  CORS_ORIGINS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    const message = `Environment validation failed:\n${formatted}`;

    // In test environment, throw so the test runner shows a clear error.
    // In production/development, log and exit to prevent starting with bad config.
    if (process.env.NODE_ENV === 'test') {
      throw new Error(message);
    }
    // eslint-disable-next-line no-console
    console.error(message);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
