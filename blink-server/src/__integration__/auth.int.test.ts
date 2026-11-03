/**
 * Auth against real Postgres: OTP storage and lockout, sessions, refresh
 * rotation/reuse, logout, socket revocation, and the production guard.
 */
import path from 'path';
import { spawnSync } from 'child_process';
import type { Socket as ClientSocket } from 'socket.io-client';
import { query } from '../config/database';
import { validateEnv } from '../config/env';
import { DEV_OTP, MAX_OTP_ATTEMPTS, storeOtp, verifyOtp } from '../services/otp';
import { REFRESH_GRACE_SECONDS } from '../services/authSessions';
import { useTestServer } from './support/server';
import { bearer, countRows, createUser } from './support/factories';
import { smsRequests } from './support/httpStubs';
import { APP_REVIEW_OTP, APP_REVIEW_PHONE } from './support/testEnv';

const server = useTestServer();

async function login(phone: string) {
  await server.api().post('/api/auth/request-otp').send({ phone_number: phone });
  const res = await server.api().post('/api/auth/verify-otp').send({ phone_number: phone, code: DEV_OTP });
  expect(res.status).toBe(200);
  return res.body as { user: { id: string }; access_token: string; refresh_token: string };
}

function sessionIdOf(refreshToken: string): string {
  return refreshToken.split('.')[0];
}

function waitForDisconnect(socket: ClientSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket was not disconnected')), timeoutMs);
    socket.once('disconnect', (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

describe('OTP', () => {
  it('stores only a hash of the code', async () => {
    const phone = '+15550001001';
    await server.api().post('/api/auth/request-otp').send({ phone_number: phone });

    const row = await query<{ code_hash: string }>('SELECT code_hash FROM otp_codes WHERE phone = $1', [phone]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.rows[0].code_hash).not.toContain(DEV_OTP);
  });

  it('accepts a correct code exactly once, even when two verifies race', async () => {
    const phone = '+15550001002';
    await server.api().post('/api/auth/request-otp').send({ phone_number: phone });

    const results = await Promise.all(
      [1, 2].map(() => server.api().post('/api/auth/verify-otp').send({ phone_number: phone, code: DEV_OTP })),
    );

    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await countRows('SELECT COUNT(*) FROM auth_sessions')).toBe(1);
  });

  it('rejects a wrong code', async () => {
    const phone = '+15550001003';
    await server.api().post('/api/auth/request-otp').send({ phone_number: phone });

    const res = await server.api().post('/api/auth/verify-otp').send({ phone_number: phone, code: '000000' });

    expect(res.status).toBe(401);
    expect(await countRows('SELECT COUNT(*) FROM users WHERE phone_number = $1', [phone])).toBe(0);
  });

  it(`locks the code after ${MAX_OTP_ATTEMPTS} attempts, even under concurrent guessing`, async () => {
    // Exercised on the service: the HTTP verify rate limit (5 / 15 min per
    // IP) would otherwise answer 429 first and hide the lockout itself.
    const phone = '+15550001004';
    await storeOtp(phone, '135790');

    const guesses = await Promise.all(Array.from({ length: 10 }, () => verifyOtp(phone, '000000')));

    expect(guesses.filter((g) => g === 'invalid')).toHaveLength(MAX_OTP_ATTEMPTS);
    expect(guesses.filter((g) => g === 'locked')).toHaveLength(10 - MAX_OTP_ATTEMPTS);
    const row = await query<{ attempts: number }>('SELECT attempts FROM otp_codes WHERE phone = $1', [phone]);
    expect(row.rows[0].attempts).toBe(MAX_OTP_ATTEMPTS);
    // The right code no longer helps.
    expect(await verifyOtp(phone, '135790')).toBe('locked');
  });

  it('a new request replaces the previous code and resets attempts', async () => {
    const phone = '+15550001005';
    await storeOtp(phone, '111111');
    await verifyOtp(phone, '000000');
    await storeOtp(phone, '222222');

    expect(await verifyOtp(phone, '111111')).toBe('invalid');
    expect(await verifyOtp(phone, '222222')).toBe('ok');
  });

  it('the App Review phone uses its configured code, without an SMS or dev hint', async () => {
    const otp = await server.api().post('/api/auth/request-otp').send({ phone_number: APP_REVIEW_PHONE });
    expect(otp.status).toBe(200);
    expect(otp.body.dev_hint).toBeUndefined();
    expect(smsRequests).toHaveLength(0);

    const dev = await server.api().post('/api/auth/verify-otp').send({ phone_number: APP_REVIEW_PHONE, code: DEV_OTP });
    expect(dev.status).toBe(401);

    await server.api().post('/api/auth/request-otp').send({ phone_number: APP_REVIEW_PHONE });
    const review = await server
      .api()
      .post('/api/auth/verify-otp')
      .send({ phone_number: APP_REVIEW_PHONE, code: APP_REVIEW_OTP });
    expect(review.status).toBe(200);
  });

  it('validates the request bodies', async () => {
    expect((await server.api().post('/api/auth/request-otp').send({})).status).toBe(400);
    expect((await server.api().post('/api/auth/request-otp').send({ phone_number: 'abc' })).status).toBe(400);
    expect(
      (await server.api().post('/api/auth/verify-otp').send({ phone_number: '+15550001006', code: '12ab56' })).status,
    ).toBe(400);
  });
});

describe('sessions and refresh', () => {
  it('rotates the refresh token and keeps the session usable', async () => {
    const first = await login('+15550002001');

    const refreshed = await server.api().post('/api/auth/refresh').send({ refresh_token: first.refresh_token });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refresh_token).not.toBe(first.refresh_token);
    expect(sessionIdOf(refreshed.body.refresh_token)).toBe(sessionIdOf(first.refresh_token));
    const me = await server.api().get('/api/auth/me').set('Authorization', `Bearer ${refreshed.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(first.user.id);
  });

  it('gives racing refreshes of the same token the same new token', async () => {
    const first = await login('+15550002002');

    const results = await Promise.all(
      [1, 2].map(() => server.api().post('/api/auth/refresh').send({ refresh_token: first.refresh_token })),
    );

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0].body.refresh_token).toBe(results[1].body.refresh_token);
  });

  it(`revokes the session when an old refresh token is reused after ${REFRESH_GRACE_SECONDS}s`, async () => {
    const first = await login('+15550002003');
    const socket = await server.connectSocket(first.access_token);
    const rotated = await server.api().post('/api/auth/refresh').send({ refresh_token: first.refresh_token });
    expect(rotated.status).toBe(200);
    await query(`UPDATE auth_sessions SET rotated_at = NOW() - make_interval(secs => $1) WHERE id = $2`, [
      REFRESH_GRACE_SECONDS + 1,
      sessionIdOf(first.refresh_token),
    ]);
    const disconnected = waitForDisconnect(socket);

    const reuse = await server.api().post('/api/auth/refresh').send({ refresh_token: first.refresh_token });

    expect(reuse.status).toBe(401);
    expect(await disconnected).toBe('io server disconnect');
    // The thief's reuse also kills the legitimate holder's newer tokens.
    const again = await server.api().post('/api/auth/refresh').send({ refresh_token: rotated.body.refresh_token });
    expect(again.status).toBe(401);
    const me = await server.api().get('/api/auth/me').set('Authorization', `Bearer ${rotated.body.access_token}`);
    expect(me.status).toBe(401);
  });

  it('rejects malformed refresh tokens without touching sessions', async () => {
    const first = await login('+15550002004');

    for (const token of ['not-a-token', `${first.user.id}.whatever`, 'abc.def']) {
      const res = await server.api().post('/api/auth/refresh').send({ refresh_token: token });
      expect(res.status).toBe(401);
    }
    expect((await server.api().post('/api/auth/refresh').send({ refreshToken: first.refresh_token })).status).toBe(400);
    expect(await countRows('SELECT COUNT(*) FROM auth_sessions WHERE revoked_at IS NULL')).toBe(1);
  });

  it('logout ends only that session and disconnects its sockets', async () => {
    const phone = '+15550002005';
    const phoneA = await login(phone);
    const phoneB = await login(phone);
    const socketA = await server.connectSocket(phoneA.access_token);
    const socketB = await server.connectSocket(phoneB.access_token);
    const disconnectedA = waitForDisconnect(socketA);

    const res = await server.api().post('/api/auth/logout').set('Authorization', `Bearer ${phoneA.access_token}`);

    expect(res.status).toBe(200);
    expect(await disconnectedA).toBe('io server disconnect');
    expect((await server.api().get('/api/auth/me').set('Authorization', `Bearer ${phoneA.access_token}`)).status).toBe(
      401,
    );
    expect((await server.api().post('/api/auth/refresh').send({ refresh_token: phoneA.refresh_token })).status).toBe(
      401,
    );
    await expect(server.connectSocket(phoneA.access_token)).rejects.toThrow(/invalid token/);
    // The other device is untouched.
    expect(socketB.connected).toBe(true);
    expect((await server.api().get('/api/auth/me').set('Authorization', `Bearer ${phoneB.access_token}`)).status).toBe(
      200,
    );
  });
});

describe('profile routes', () => {
  it('PATCH /api/auth/profile updates name and bio', async () => {
    const alice = await createUser();

    const res = await server
      .api()
      .patch('/api/auth/profile')
      .set(bearer(alice))
      .send({ display_name: 'Alice B', bio: 'Climber' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: alice.id, display_name: 'Alice B', bio: 'Climber' });
    expect((await server.api().patch('/api/auth/profile').set(bearer(alice)).send({})).status).toBe(400);
  });

  it('POST /api/auth/push-token stores the token', async () => {
    const alice = await createUser();

    const res = await server
      .api()
      .post('/api/auth/push-token')
      .set(bearer(alice))
      .send({ push_token: 'ExponentPushToken[abc123]' });

    expect(res.status).toBe(200);
    const row = await query('SELECT push_token FROM users WHERE id = $1', [alice.id]);
    expect(row.rows[0].push_token).toBe('ExponentPushToken[abc123]');
  });

  it('GET /api/auth/stats summarises the user', async () => {
    const alice = await createUser();

    const res = await server.api().get('/api/auth/stats').set(bearer(alice));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total_snaps: 0, longest_streak: 0, group_count: 0 });
  });
});

describe('production guard', () => {
  const baseEnv = {
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
    DATABASE_URL: 'postgresql://unused/blink',
  };

  it('the env schema requires Twilio, an OTP pepper and a support address in production', () => {
    const missing = validateEnv(baseEnv);
    expect(missing.success).toBe(false);
    const fields = missing.success ? [] : missing.error.issues.map((i) => i.path.join('.'));
    expect(fields).toEqual(
      expect.arrayContaining([
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_PHONE_NUMBER',
        'OTP_PEPPER',
        'SUPPORT_EMAIL',
      ]),
    );

    const complete = validateEnv({
      ...baseEnv,
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'secret',
      TWILIO_PHONE_NUMBER: '+15550000001',
      OTP_PEPPER: 'p'.repeat(32),
      SUPPORT_EMAIL: 'help@example.com',
    });
    expect(complete.success).toBe(true);
  });

  it('the server refuses to start in production without Twilio', () => {
    const serverRoot = path.resolve(__dirname, '../..');
    const child = spawnSync(
      process.execPath,
      [require.resolve('ts-node/dist/bin'), '--transpile-only', 'src/server.ts'],
      {
        cwd: serverRoot,
        env: {
          ...baseEnv,
          PATH: process.env.PATH,
          TWILIO_ACCOUNT_SID: '',
          TWILIO_AUTH_TOKEN: '',
          TWILIO_PHONE_NUMBER: '',
        },
        encoding: 'utf-8',
        timeout: 60_000,
      },
    );

    expect(child.status).toBe(1);
    expect(child.stderr).toContain('TWILIO_ACCOUNT_SID is required in production');
  }, 70_000);
});
