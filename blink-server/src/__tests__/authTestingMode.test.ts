/**
 * TESTING_MODE universal OTP bypass.
 *
 * For closed testing we let testers "jump right in": when TESTING_MODE is on,
 * verify-otp accepts the universal dev code (123456) for ANY phone number,
 * without a prior request-otp / SMS. It still issues a real per-user session
 * (JWT) so identity-dependent features — groups, challenges, the E2E photo
 * key flow — keep working. The flag is OFF by default and NOT gated on
 * NODE_ENV, so it can be toggled on the production backend for a test phase
 * and flipped off afterwards.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createTestApp, makeUser, queryResult } from './helpers';

import './setup';

import authRouter from '../routes/auth';
import { query } from '../config/database';
import { env } from '../config/env';

const mockQuery = query as jest.MockedFunction<typeof query>;
const app = createTestApp(authRouter, '/api/auth');

const phone = '+15559990000';

describe('verify-otp — TESTING_MODE bypass', () => {
  afterEach(() => {
    delete (env as unknown as Record<string, unknown>).TESTING_MODE;
  });

  it('accepts 123456 for any phone with no prior request-otp when TESTING_MODE is on', async () => {
    (env as unknown as Record<string, unknown>).TESTING_MODE = 'true';
    const user = makeUser({ phone_number: phone });
    mockQuery.mockResolvedValueOnce(queryResult([user])); // user upsert

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone_number: phone, code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.user.phone_number).toBe(phone);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    const decoded = jwt.verify(res.body.accessToken, process.env.JWT_SECRET!) as { userId: string };
    expect(decoded.userId).toBe(user.id);
  });

  it('still rejects a wrong code when TESTING_MODE is on (no stored OTP → 401)', async () => {
    (env as unknown as Record<string, unknown>).TESTING_MODE = 'true';

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone_number: phone, code: '999999' });

    expect(res.status).toBe(401);
  });

  it('does NOT accept 123456 without a stored OTP when TESTING_MODE is off', async () => {
    // TESTING_MODE unset (default). No request-otp was issued, so there is
    // no pending code for this phone → normal path returns 401.
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone_number: phone, code: '123456' });

    expect(res.status).toBe(401);
  });
});
