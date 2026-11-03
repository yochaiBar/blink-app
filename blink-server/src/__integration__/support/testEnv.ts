/**
 * Environment for the integration suite. Shared by globalSetup (parent
 * process) and env.ts (every test file, before any app module loads).
 */

export function resolveTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Start Postgres with `docker compose up -d postgres` (repo root) and run:\n' +
        '  TEST_DATABASE_URL=postgresql://blink:blink_dev_password@localhost:5432/blink_test npm run test:integration',
    );
  }
  const dbName = testDatabaseName(url);
  // The suite drops and recreates the public schema — never let it loose
  // on a dev or production database by accident.
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run integration tests against database "${dbName}": ` +
        'TEST_DATABASE_URL must name a database containing "test" because the suite wipes its schema.',
    );
  }
  return url;
}

export function testDatabaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

// Keys a developer's local .env could inject. dotenv never overrides a key
// that is already set, so blanking them keeps the suite hermetic: no real
// Twilio/Expo/Sentry calls, no auto-challenge scheduler.
const BLANKED_KEYS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'ALLOW_DEV_OTP_FALLBACK',
  'SENTRY_DSN',
  'CHALLENGE_SCHEDULER_ENABLED',
  'EXPO_ACCESS_TOKEN',
];

// A fixed App Store review login, enabled for every integration run.
export const APP_REVIEW_PHONE = '+15550000999';
export const APP_REVIEW_OTP = '424242';

export function applyIntegrationEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = resolveTestDatabaseUrl();
  process.env.JWT_SECRET = 'integration-jwt-secret-0123456789';
  process.env.JWT_REFRESH_SECRET = 'integration-jwt-refresh-secret-0123456789';
  process.env.PORT = '0';
  process.env.OTP_PEPPER = 'integration-otp-pepper-0123456789';
  process.env.APP_REVIEW_PHONE = APP_REVIEW_PHONE;
  process.env.APP_REVIEW_OTP = APP_REVIEW_OTP;
  for (const key of BLANKED_KEYS) {
    process.env[key] = '';
  }
}
