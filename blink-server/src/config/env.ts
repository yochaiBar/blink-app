import dotenv from 'dotenv';
import { z } from 'zod';

// Every entry point (server, standalone migration runner) gets .env loaded
// before the schema runs; existing variables always win.
dotenv.config();

/**
 * Zod-validated environment configuration.
 *
 * This module parses `process.env` at import time and is the only place
 * that may read it (lint enforces this). Because the test setup
 * (`__tests__/setup.ts`) assigns all required env vars before any source
 * imports, the eager parse is safe for both production and test environments.
 */

const baseSchema = z.object({
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

  // ── Twilio (required in production — see productionRules) ───────
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // ── OTP ─────────────────────────────────────────────────────────
  // HMAC key for stored login codes. Required in production.
  OTP_PEPPER: z.string().optional(),
  // App Store review login: this one phone number accepts this fixed code
  // without an SMS. Set both or neither; leave unset outside review windows.
  APP_REVIEW_PHONE: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'APP_REVIEW_PHONE must be E.164 (e.g. +15551234567)')
    .optional()
    .or(z.literal('')),
  APP_REVIEW_OTP: z
    .string()
    .regex(/^\d{6}$/, 'APP_REVIEW_OTP must be 6 digits')
    .optional()
    .or(z.literal('')),

  // ── Jobs and push ───────────────────────────────────────────────
  CHALLENGE_SCHEDULER_ENABLED: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  // ── Observability ───────────────────────────────────────────────
  SENTRY_DSN: z.string().optional(),

  // ── Database extras (used by database.ts pool config) ───────────
  DB_POOL_MAX: z.string().optional(),
  DB_SSL_REJECT_UNAUTHORIZED: z.string().optional(),
  DB_SSL_CERT: z.string().optional(),

  // ── CORS ────────────────────────────────────────────────────────
  CORS_ORIGINS: z.string().optional(),

  // ── App links (routes/wellKnown.ts) ─────────────────────────────
  // Served at the invite-link domain so https://<domain>/join/CODE opens
  // the app. Unset → those files 404 and links open in the browser.
  APPLE_TEAM_ID: z.string().optional(), // e.g. RW54G9U2AP
  IOS_BUNDLE_ID: z.string().optional(), // e.g. com.yochaibar.blinks
  ANDROID_PACKAGE: z.string().optional(),
  ANDROID_CERT_SHA256: z.string().optional(), // comma-separated signing-cert fingerprints
  // Shown on the /join/CODE landing page to people without the app
  // (TestFlight or store link). Unset → no get-the-app line.
  APP_DOWNLOAD_URL: z.string().url().optional(),

  // ── Contact ─────────────────────────────────────────────────────
  // The address the privacy policy and terms give for privacy, security,
  // legal and support questions. Required in production.
  SUPPORT_EMAIL: z.string().email().optional(),
});

// Production must never fall back to the dev OTP (123456): without Twilio
// the server refuses to boot instead of quietly accepting a known code.
const envSchema = baseSchema.superRefine((e, ctx) => {
  if (!!e.APP_REVIEW_PHONE !== !!e.APP_REVIEW_OTP) {
    ctx.addIssue({
      code: 'custom',
      path: ['APP_REVIEW_OTP'],
      message: 'Set APP_REVIEW_PHONE and APP_REVIEW_OTP together',
    });
  }
  if (e.NODE_ENV !== 'production') return;
  for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'] as const) {
    if (!e[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
  }
  if (!e.SUPPORT_EMAIL) {
    ctx.addIssue({ code: 'custom', path: ['SUPPORT_EMAIL'], message: 'SUPPORT_EMAIL is required in production' });
  }
  if (!e.OTP_PEPPER || e.OTP_PEPPER.length < 16) {
    ctx.addIssue({ code: 'custom', path: ['OTP_PEPPER'], message: 'OTP_PEPPER (16+ chars) is required in production' });
  }
});

export type Env = z.infer<typeof envSchema>;

/** Validate an environment without side effects (exported for tests). */
export function validateEnv(source: Record<string, string | undefined>) {
  return envSchema.safeParse(source);
}

function parseEnv(): Env {
  const result = validateEnv(process.env);
  if (!result.success) {
    const formatted = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
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
