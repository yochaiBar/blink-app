/**
 * Device public key route tests — E2E photo flow Phase 2.
 *
 * Covers POST /api/device-keys: attestation verification (positive + negative),
 * upsert / rotation, and tombstoning of other devices on register.
 *
 * Crypto note: the route uses HMAC-SHA256(JWT, public_key) for attestation.
 * Tests compute the same HMAC against the test JWT to produce valid bodies;
 * the negative cases either tamper the public key or pass garbage.
 */

import request from 'supertest';
import { createHmac, randomBytes } from 'node:crypto';
import {
  createTestApp,
  generateAccessToken,
  TEST_USER_ID,
  queryResult,
} from './helpers';

import './setup';

import deviceKeysRouter from '../routes/deviceKeys';
import { query } from '../config/database';

const mockQuery = query as jest.MockedFunction<typeof query>;
const app = createTestApp(deviceKeysRouter, '/api/device-keys');

const TEST_DEVICE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';

// 32 random bytes, base64'd → 44 chars. Stable per-test for determinism.
function makePublicKeyB64(): string {
  return randomBytes(32).toString('base64');
}

function makeAttestation(token: string, publicKeyB64: string): string {
  const publicKeyBytes = Buffer.from(publicKeyB64, 'base64');
  return createHmac('sha256', Buffer.from(token, 'utf8'))
    .update(publicKeyBytes)
    .digest('base64');
}

describe('POST /api/device-keys', () => {
  const token = generateAccessToken(TEST_USER_ID);
  const publicKeyB64 = makePublicKeyB64();
  const validAttestation = makeAttestation(token, publicKeyB64);

  it('registers a device key with valid attestation', async () => {
    mockQuery
      .mockResolvedValueOnce(
        queryResult([
          {
            device_id: TEST_DEVICE_ID,
            key_version: 1,
            registered_at: new Date().toISOString(),
          },
        ]),
      )
      .mockResolvedValueOnce(queryResult([])); // tombstone-others UPDATE

    const res = await request(app)
      .post('/api/device-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({
        v: 1,
        device_id: TEST_DEVICE_ID,
        x25519_public_key_b64: publicKeyB64,
        attestation_b64: validAttestation,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      v: 1,
      device_id: TEST_DEVICE_ID,
      key_version: 1,
    });
  });

  it('rejects with 400 when attestation does not match the JWT', async () => {
    const bogusAttestation = makeAttestation('a-different-token', publicKeyB64);

    const res = await request(app)
      .post('/api/device-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({
        v: 1,
        device_id: TEST_DEVICE_ID,
        x25519_public_key_b64: publicKeyB64,
        attestation_b64: bogusAttestation,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/attestation/i);
    // Critical: the DB must never have been touched — attestation gates
    // everything else.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects with 400 when attestation is for a different public key', async () => {
    const attackerPublicKey = makePublicKeyB64();
    // Attestation computed for the attacker's key, but the body claims a
    // different public key. The HMAC won't match because the message is the
    // public-key bytes in the body, not what the attestation was made for.
    const attestationForOtherKey = makeAttestation(token, attackerPublicKey);

    const res = await request(app)
      .post('/api/device-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({
        v: 1,
        device_id: TEST_DEVICE_ID,
        x25519_public_key_b64: publicKeyB64,
        attestation_b64: attestationForOtherKey,
      });

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects with 400 on garbage attestation', async () => {
    // Length-correct but unrelated random bytes.
    const garbage = randomBytes(32).toString('base64');

    const res = await request(app)
      .post('/api/device-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({
        v: 1,
        device_id: TEST_DEVICE_ID,
        x25519_public_key_b64: publicKeyB64,
        attestation_b64: garbage,
      });

    expect(res.status).toBe(400);
  });

  it('rejects with 400 on malformed base64 in public key', async () => {
    const malformed = 'not-base64-not-44-chars-yikes';

    const res = await request(app)
      .post('/api/device-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({
        v: 1,
        device_id: TEST_DEVICE_ID,
        x25519_public_key_b64: malformed,
        attestation_b64: validAttestation,
      });

    expect(res.status).toBe(400);
  });

  it('rejects with 400 when v is not 1', async () => {
    const res = await request(app)
      .post('/api/device-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({
        v: 2,
        device_id: TEST_DEVICE_ID,
        x25519_public_key_b64: publicKeyB64,
        attestation_b64: validAttestation,
      });

    expect(res.status).toBe(400);
  });

  it('rejects with 401 when no JWT is present', async () => {
    const res = await request(app)
      .post('/api/device-keys')
      .send({
        v: 1,
        device_id: TEST_DEVICE_ID,
        x25519_public_key_b64: publicKeyB64,
        attestation_b64: validAttestation,
      });

    expect(res.status).toBe(401);
  });

  it('tombstones other active devices for the same user on register', async () => {
    mockQuery
      .mockResolvedValueOnce(
        queryResult([
          {
            device_id: TEST_DEVICE_ID,
            key_version: 1,
            registered_at: new Date().toISOString(),
          },
        ]),
      )
      .mockResolvedValueOnce(queryResult([], 2)); // 2 other rows tombstoned

    const res = await request(app)
      .post('/api/device-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({
        v: 1,
        device_id: TEST_DEVICE_ID,
        x25519_public_key_b64: publicKeyB64,
        attestation_b64: validAttestation,
      });

    expect(res.status).toBe(200);
    // 2nd call is the tombstone UPDATE — verify its WHERE clause excludes
    // the just-registered device_id and only targets the same user.
    const tombstoneCall = mockQuery.mock.calls[1];
    expect(tombstoneCall[0]).toMatch(/SET tombstoned_at = NOW\(\)/i);
    expect(tombstoneCall[0]).toMatch(/device_id <> \$2/);
    expect(tombstoneCall[0]).toMatch(/tombstoned_at IS NULL/i);
    expect(tombstoneCall[1]).toEqual([TEST_USER_ID, TEST_DEVICE_ID]);
  });

  it('upserts on re-register (same device_id) and bumps key_version', async () => {
    // The route delegates to the SQL ON CONFLICT clause for the bump; we
    // verify the right query is issued.
    mockQuery
      .mockResolvedValueOnce(
        queryResult([
          {
            device_id: TEST_DEVICE_ID,
            key_version: 4,
            registered_at: new Date().toISOString(),
          },
        ]),
      )
      .mockResolvedValueOnce(queryResult([]));

    const newPublicKey = makePublicKeyB64();
    const newAttestation = makeAttestation(token, newPublicKey);

    const res = await request(app)
      .post('/api/device-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({
        v: 1,
        device_id: TEST_DEVICE_ID,
        x25519_public_key_b64: newPublicKey,
        attestation_b64: newAttestation,
      });

    expect(res.status).toBe(200);
    expect(res.body.key_version).toBe(4);
    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[0]).toMatch(/ON CONFLICT \(user_id, device_id\) DO UPDATE/);
    expect(insertCall[0]).toMatch(/key_version\s*=\s*device_public_keys\.key_version \+ 1/);
    expect(insertCall[0]).toMatch(/tombstoned_at\s*=\s*NULL/);
  });
});
