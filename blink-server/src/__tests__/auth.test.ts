/**
 * Auth Route Tests - blink-server
 *
 * Covers:
 * - POST /api/auth/request-otp (dev mode OTP request)
 * - POST /api/auth/verify-otp (dev mode OTP verification, user upsert, JWT issuance)
 * - POST /api/auth/refresh (token refresh flow)
 * - GET /api/auth/me (authenticated profile fetch)
 * - PATCH /api/auth/profile (profile update)
 * - DELETE /api/auth/delete-account (account deletion cascade)
 *
 * Each section tests: happy path, validation errors, auth errors, edge cases
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import {
  createTestApp,
  generateAccessToken,
  generateRefreshToken,
  generateExpiredToken,
  generateMalformedToken,
  TEST_USER_ID,
  makeUser,
  queryResult,
  XSS_PAYLOADS,
  SQL_INJECTION_PAYLOADS,
} from './helpers';

// Must import setup mocks first
import './setup';

import authRouter from '../routes/auth';
import { query } from '../config/database';

const mockQuery = query as jest.MockedFunction<typeof query>;
const app = createTestApp(authRouter, '/api/auth');

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/request-otp
// ─────────────────────────────────────────────────────────────────
describe('POST /api/auth/request-otp', () => {
  it('should return OTP sent response for valid phone number (dev mode)', async () => {
    const res = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone_number: '+15551234567' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('OTP sent');
  });

  it('should accept phone number without + prefix and normalize it', async () => {
    const res = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone_number: '15551234567' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('OTP sent');
  });

  it('should return 400 for missing phone_number', async () => {
    const res = await request(app)
      .post('/api/auth/request-otp')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should return 400 for invalid phone number format', async () => {
    const res = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone_number: 'not-a-phone' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should return 400 for empty phone_number', async () => {
    const res = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone_number: '' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for phone number with letters', async () => {
    const res = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone_number: '+1555abc4567' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for phone number that is too long', async () => {
    const res = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone_number: '+12345678901234567890' });

    expect(res.status).toBe(400);
  });

  // Security: SQL injection attempts should be caught by validation
  it.each(SQL_INJECTION_PAYLOADS)(
    'should reject SQL injection payload: %s',
    async (payload) => {
      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ phone_number: payload });

      expect(res.status).toBe(400);
    }
  );
});

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/verify-otp
// ─────────────────────────────────────────────────────────────────
describe('POST /api/auth/verify-otp', () => {
  const phone = '+15551234567';

  beforeEach(async () => {
    // Request an OTP first so the in-memory store has the code
    await request(app)
      .post('/api/auth/request-otp')
      .send({ phone_number: phone });
  });

  it('should verify correct OTP and return user + tokens (dev mode)', async () => {
    const user = makeUser({ phone_number: phone });
    mockQuery.mockResolvedValueOnce(queryResult([user]));

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone_number: phone, code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.phone_number).toBe(phone);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();

    // Verify that the access token is a valid JWT
    const decoded = jwt.verify(res.body.accessToken, process.env.JWT_SECRET!) as any;
    expect(decoded.userId).toBe(user.id);
  });

  it('should return 401 for wrong OTP code', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone_number: phone, code: '999999' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired OTP');
  });

  it('should return 401 for OTP that was already consumed', async () => {
    const user = makeUser({ phone_number: phone });
    mockQuery.mockResolvedValueOnce(queryResult([user]));

    // First verification succeeds
    await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone_number: phone, code: '123456' });

    // Second attempt with same OTP should fail
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone_number: phone, code: '123456' });

    expect(res.status).toBe(401);
  });

  it('should return 400 for missing phone_number and code', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 400 for code that is not 6 digits', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone_number: phone, code: '12345' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for code with non-numeric characters', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone_number: phone, code: 'abcdef' });

    expect(res.status).toBe(400);
  });

  it('should return 401 for phone number that never requested an OTP', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone_number: '+19995550000', code: '123456' });

    expect(res.status).toBe(401);
  });

  it('should handle database error during user upsert gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone_number: phone, code: '123456' });

    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// ─────────────────────────────────────────────────────────────────
describe('POST /api/auth/refresh', () => {
  it('should return a new access token for a valid refresh token', async () => {
    const refreshToken = generateRefreshToken(TEST_USER_ID);

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();

    const decoded = jwt.verify(res.body.accessToken, process.env.JWT_SECRET!) as any;
    expect(decoded.userId).toBe(TEST_USER_ID);
  });

  it('should return 401 for expired refresh token', async () => {
    const expiredToken = jwt.sign(
      { userId: TEST_USER_ID },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: '0s' }
    );

    // Small delay to ensure token is truly expired
    await new Promise((r) => setTimeout(r, 100));

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: expiredToken });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid refresh token');
  });

  it('should return 401 for malformed refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid refresh token');
  });

  it('should return 400 for missing refreshToken field', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should return 400 for empty refreshToken string', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: '' });

    expect(res.status).toBe(400);
  });

  it('should return 401 for token signed with wrong secret', async () => {
    const wrongToken = jwt.sign({ userId: TEST_USER_ID }, 'wrong-secret', { expiresIn: '7d' });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: wrongToken });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/auth/me
// ─────────────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  it('should return user profile for authenticated request', async () => {
    const user = makeUser();
    mockQuery.mockResolvedValueOnce(queryResult([user]));

    const token = generateAccessToken(TEST_USER_ID);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TEST_USER_ID);
    expect(res.body.phone_number).toBe(user.phone_number);
    expect(res.body.display_name).toBe(user.display_name);
  });

  it('should return 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('should return 401 for expired access token', async () => {
    const expiredToken = generateExpiredToken(TEST_USER_ID);
    await new Promise((r) => setTimeout(r, 100));

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid token');
  });

  it('should return 401 for malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${generateMalformedToken()}`);

    expect(res.status).toBe(401);
  });

  it('should return 401 for Authorization header without Bearer prefix', async () => {
    const token = generateAccessToken(TEST_USER_ID);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', token);

    expect(res.status).toBe(401);
  });

  it('should return 404 when user no longer exists in database', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const token = generateAccessToken(TEST_USER_ID);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('should handle database errors gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

    const token = generateAccessToken(TEST_USER_ID);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────
// PATCH /api/auth/profile
// ─────────────────────────────────────────────────────────────────
describe('PATCH /api/auth/profile', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should update display_name successfully', async () => {
    const updatedUser = makeUser({ display_name: 'New Name' });
    mockQuery.mockResolvedValueOnce(queryResult([updatedUser]));

    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ display_name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.display_name).toBe('New Name');
  });

  it('should update bio successfully', async () => {
    const updatedUser = makeUser({ bio: 'My new bio' });
    mockQuery.mockResolvedValueOnce(queryResult([updatedUser]));

    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ bio: 'My new bio' });

    expect(res.status).toBe(200);
    expect(res.body.bio).toBe('My new bio');
  });

  it('should update avatar_url successfully', async () => {
    const updatedUser = makeUser({ avatar_url: 'https://new.example.com/avatar.jpg' });
    mockQuery.mockResolvedValueOnce(queryResult([updatedUser]));

    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar_url: 'https://new.example.com/avatar.jpg' });

    expect(res.status).toBe(200);
  });

  it('should allow clearing avatar_url with empty string', async () => {
    const updatedUser = makeUser({ avatar_url: null });
    mockQuery.mockResolvedValueOnce(queryResult([updatedUser]));

    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar_url: '' });

    expect(res.status).toBe(200);
  });

  it('should update multiple fields at once', async () => {
    const updatedUser = makeUser({ display_name: 'Updated', bio: 'Updated bio' });
    mockQuery.mockResolvedValueOnce(queryResult([updatedUser]));

    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ display_name: 'Updated', bio: 'Updated bio' });

    expect(res.status).toBe(200);
  });

  it('should return 400 when no fields provided', async () => {
    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should return 400 for display_name exceeding 50 characters', async () => {
    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ display_name: 'A'.repeat(51) });

    expect(res.status).toBe(400);
  });

  it('should return 400 for bio exceeding 200 characters', async () => {
    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ bio: 'X'.repeat(201) });

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid avatar_url (not a URL)', async () => {
    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar_url: 'not-a-url' });

    expect(res.status).toBe(400);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .patch('/api/auth/profile')
      .send({ display_name: 'Test' });

    expect(res.status).toBe(401);
  });

  it('should return 404 when user no longer exists', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ display_name: 'Ghost' });

    expect(res.status).toBe(404);
  });

  // XSS payload testing - these should be stored as-is (parameterized queries prevent injection)
  // but the Zod schema validations still apply
  it.each(XSS_PAYLOADS)(
    'should handle XSS payload in display_name without crashing: %s',
    async (payload) => {
      // XSS strings are <= 50 chars, so they pass Zod validation
      // The important thing is they don't crash the server
      if (payload.length <= 50) {
        const updatedUser = makeUser({ display_name: payload });
        mockQuery.mockResolvedValueOnce(queryResult([updatedUser]));

        const res = await request(app)
          .patch('/api/auth/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ display_name: payload });

        // Should not crash - either 200 (stored safely via parameterized query) or 400 (validation)
        expect([200, 400]).toContain(res.status);
      }
    }
  );
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/auth/delete-account
// ─────────────────────────────────────────────────────────────────
describe('DELETE /api/auth/delete-account', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should delete account successfully', async () => {
    // First query: DELETE FROM group_members
    mockQuery.mockResolvedValueOnce(queryResult([]));
    // Second query: DELETE FROM users RETURNING id
    mockQuery.mockResolvedValueOnce(queryResult([{ id: TEST_USER_ID }]));

    const res = await request(app)
      .delete('/api/auth/delete-account')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Account deleted successfully');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .delete('/api/auth/delete-account');

    expect(res.status).toBe(401);
  });

  it('should return 404 when user does not exist', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([])); // group_members delete
    mockQuery.mockResolvedValueOnce(queryResult([])); // users delete returns nothing

    const res = await request(app)
      .delete('/api/auth/delete-account')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('should handle database error during deletion', async () => {
    mockQuery.mockRejectedValueOnce(new Error('FK constraint violation'));

    const res = await request(app)
      .delete('/api/auth/delete-account')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
  });
});
