/**
 * Test Helpers - blink-server
 *
 * Provides utilities for:
 * - Creating Express app instances for supertest
 * - Generating valid JWT tokens for authenticated requests
 * - Building mock database query results
 * - Common test data factories
 */

import express from 'express';
import jwt from 'jsonwebtoken';

// ── App factory ──────────────────────────────────────────────────

export function createTestApp(router: express.Router, prefix = '/api') {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(prefix, router);

  // Error handler matching the real server
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
    });
  });

  return app;
}

// ── JWT helpers ──────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-jwt-refresh-secret-for-unit-tests';

export function generateAccessToken(userId: string = TEST_USER_ID): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
}

export function generateRefreshToken(userId: string = TEST_USER_ID): string {
  return jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

export function generateExpiredToken(userId: string = TEST_USER_ID): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '0s' });
}

export function generateMalformedToken(): string {
  return 'eyJhbGciOiJIUzI1NiJ9.INVALID.PAYLOAD';
}

// ── User ID constants (valid UUID v4 format) ─────────────────────
// UUID v4: xxxxxxxx-xxxx-4xxx-{8,9,a,b}xxx-xxxxxxxxxxxx

export const TEST_USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
export const TEST_USER_ID_2 = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
export const TEST_USER_ID_3 = 'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f';
export const TEST_GROUP_ID = 'd4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f7a';
export const TEST_CHALLENGE_ID = 'e5f6a7b8-c9d0-4e1f-9a2b-3c4d5e6f7a8b';
export const TEST_RESPONSE_ID = 'f6a7b8c9-d0e1-4f2a-ab3c-4d5e6f7a8b9c';
export const TEST_NOTIFICATION_ID = 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f7a8b9c0d';
export const TEST_INVITE_CODE = 'ABCD1234';

// ── Data factories ───────────────────────────────────────────────

export function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? TEST_USER_ID,
    phone_number: overrides.phone_number ?? '+15551234567',
    display_name: overrides.display_name ?? 'Test User',
    avatar_url: overrides.avatar_url ?? 'https://blinks3upload.s3.us-east-1.amazonaws.com/avatars/test.jpg',
    bio: overrides.bio ?? 'Test bio',
    created_at: overrides.created_at ?? new Date().toISOString(),
    last_active_at: overrides.last_active_at ?? new Date().toISOString(),
  };
}

export function makeGroup(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? TEST_GROUP_ID,
    name: overrides.name ?? 'Test Group',
    icon: overrides.icon ?? '🔥',
    category: overrides.category ?? 'friends',
    created_by: overrides.created_by ?? TEST_USER_ID,
    invite_code: overrides.invite_code ?? TEST_INVITE_CODE,
    max_members: overrides.max_members ?? 15,
    quiet_hours_start: overrides.quiet_hours_start ?? '22:00',
    quiet_hours_end: overrides.quiet_hours_end ?? '08:00',
    skip_penalty_type: overrides.skip_penalty_type ?? 'wanted_poster',
    ai_personality: overrides.ai_personality ?? 'funny',
    created_at: overrides.created_at ?? new Date().toISOString(),
  };
}

export function makeMembership(overrides: Record<string, any> = {}) {
  return {
    group_id: overrides.group_id ?? TEST_GROUP_ID,
    user_id: overrides.user_id ?? TEST_USER_ID,
    role: overrides.role ?? 'member',
    joined_at: overrides.joined_at ?? new Date().toISOString(),
    current_streak: overrides.current_streak ?? 0,
    total_responses: overrides.total_responses ?? 0,
    total_challenges: overrides.total_challenges ?? 0,
  };
}

export function makeChallenge(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? TEST_CHALLENGE_ID,
    group_id: overrides.group_id ?? TEST_GROUP_ID,
    type: overrides.type ?? 'snap',
    prompt_text: overrides.prompt_text ?? null,
    options_json: overrides.options_json ?? null,
    triggered_by: overrides.triggered_by ?? TEST_USER_ID,
    triggered_at: overrides.triggered_at ?? new Date().toISOString(),
    expires_at: overrides.expires_at ?? new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    countdown_seconds: overrides.countdown_seconds ?? 10,
    status: overrides.status ?? 'active',
  };
}

export function makeChallengeResponse(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? TEST_RESPONSE_ID,
    challenge_id: overrides.challenge_id ?? TEST_CHALLENGE_ID,
    user_id: overrides.user_id ?? TEST_USER_ID,
    response_type: overrides.response_type ?? 'photo',
    photo_url: overrides.photo_url ?? 'https://blinks3upload.s3.us-east-1.amazonaws.com/photos/test.jpg',
    answer_index: overrides.answer_index ?? null,
    responded_at: overrides.responded_at ?? new Date().toISOString(),
    response_time_ms: overrides.response_time_ms ?? 3500,
  };
}

export function makeNotification(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? TEST_NOTIFICATION_ID,
    user_id: overrides.user_id ?? TEST_USER_ID,
    type: overrides.type ?? 'challenge_started',
    title: overrides.title ?? 'New Challenge!',
    body: overrides.body ?? 'Someone started a snap challenge',
    group_id: overrides.group_id ?? TEST_GROUP_ID,
    from_user_id: overrides.from_user_id ?? TEST_USER_ID_2,
    read: overrides.read ?? false,
    created_at: overrides.created_at ?? new Date().toISOString(),
  };
}

// ── Query result builder ─────────────────────────────────────────

export function queryResult(rows: any[], rowCount?: number) {
  return { rows, rowCount: rowCount ?? rows.length } as any;
}

// ── Auth header helper ───────────────────────────────────────────

export function authHeader(userId: string = TEST_USER_ID) {
  return { Authorization: `Bearer ${generateAccessToken(userId)}` };
}

// ── XSS / injection test payloads ────────────────────────────────

export const XSS_PAYLOADS = [
  '<script>alert("xss")</script>',
  'javascript:alert(1)',
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  "'; DROP TABLE users; --",
];

export const SQL_INJECTION_PAYLOADS = [
  "'; DROP TABLE users; --",
  "1' OR '1'='1",
  "' UNION SELECT * FROM users --",
  "1; DELETE FROM users WHERE '1'='1",
  "admin'--",
];
