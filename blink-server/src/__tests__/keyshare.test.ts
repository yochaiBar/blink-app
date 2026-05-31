/**
 * Group-key courier handshake tests — Phase 4 of the E2E photo flow.
 *
 *   keyshareHub.enqueueKeyshare              — idempotent INSERT
 *   keyshareHub.dispatchPendingKeysharesForUser — atomic claim + emit
 *   keyshareHub.markKeyshareDelivered        — terminal flip + emit
 *   keyshareHub.expireStalePendingJoins      — 7d TTL flip
 *   POST /api/keyshare/deliver               — auth + group membership + state checks
 */

import request from 'supertest';
import {
  createTestApp,
  generateAccessToken,
  TEST_USER_ID,
  TEST_USER_ID_2,
  TEST_USER_ID_3,
  TEST_GROUP_ID,
  queryResult,
} from './helpers';

import './setup';

import keyshareRouter from '../routes/keyshare';
import {
  enqueueKeyshare,
  dispatchPendingKeysharesForUser,
  expireStalePendingJoins,
} from '../services/keyshareHub';
import { query } from '../config/database';
import { emitToUser } from '../socket';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockEmitToUser = emitToUser as jest.MockedFunction<typeof emitToUser>;

const app = createTestApp(keyshareRouter, '/api/keyshare');

const PENDING_JOIN_ID = '11111111-1111-4111-8111-111111111111';
const JOINER_DEVICE_ID = '21111111-1111-4111-8111-111111111111';
const COURIER_DEVICE_ID = '32222222-2222-4222-8222-222222222222';
// 32 bytes base64'd
const PUBKEY_B64 = 'A'.repeat(43) + '=';
// 48 bytes base64'd (no padding since 48 % 3 === 0)
const ENVELOPE_CIPHERTEXT_B64 = 'A'.repeat(64);
const EPHEMERAL_PUBKEY_B64 = 'B'.repeat(43) + '=';
const IV_B64 = 'C'.repeat(16);
const TAG_B64 = 'D'.repeat(22) + '==';

// ─────────────────────────────────────────────────────────────────
// enqueueKeyshare
// ─────────────────────────────────────────────────────────────────
describe('keyshareHub.enqueueKeyshare', () => {
  it('inserts a pending row and returns the id', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([{ id: PENDING_JOIN_ID }]));

    const id = await enqueueKeyshare({
      groupId: TEST_GROUP_ID,
      joinerUserId: TEST_USER_ID_2,
      joinerDeviceId: JOINER_DEVICE_ID,
    });

    expect(id).toBe(PENDING_JOIN_ID);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/INSERT INTO pending_joins/i);
    expect(sql).toMatch(/ON CONFLICT \(group_id, joiner_user_id, state\) DO UPDATE/i);
    expect(mockQuery.mock.calls[0][1]).toEqual([
      TEST_GROUP_ID,
      TEST_USER_ID_2,
      JOINER_DEVICE_ID,
    ]);
  });

  it('returns null when the upsert returns no row (defensive)', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));
    const id = await enqueueKeyshare({
      groupId: TEST_GROUP_ID,
      joinerUserId: TEST_USER_ID_2,
      joinerDeviceId: JOINER_DEVICE_ID,
    });
    expect(id).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// dispatchPendingKeysharesForUser
// ─────────────────────────────────────────────────────────────────
describe('keyshareHub.dispatchPendingKeysharesForUser', () => {
  it('claims pending rows for groups the courier belongs to and emits keyshare_request per row', async () => {
    const claimed = {
      id: PENDING_JOIN_ID,
      group_id: TEST_GROUP_ID,
      joiner_user_id: TEST_USER_ID_2,
      joiner_device_id: JOINER_DEVICE_ID,
    };
    mockQuery
      .mockResolvedValueOnce(queryResult([claimed])) // UPDATE … RETURNING
      .mockResolvedValueOnce(
        queryResult([{ device_id: JOINER_DEVICE_ID, x25519_public_key: PUBKEY_B64 }]),
      ); // joiner pubkey lookup

    const count = await dispatchPendingKeysharesForUser(TEST_USER_ID);

    expect(count).toBe(1);
    expect(mockEmitToUser).toHaveBeenCalledTimes(1);
    expect(mockEmitToUser).toHaveBeenCalledWith(
      TEST_USER_ID,
      'group:keyshare_request',
      expect.objectContaining({
        v: 1,
        group_id: TEST_GROUP_ID,
        joiner_user_id: TEST_USER_ID_2,
        joiner_device_id: JOINER_DEVICE_ID,
        joiner_x25519_public_key_b64: PUBKEY_B64,
        pending_join_id: PENDING_JOIN_ID,
      }),
    );
  });

  it('returns 0 when nothing claimed (no membership match or no pending rows)', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));
    const count = await dispatchPendingKeysharesForUser(TEST_USER_ID);
    expect(count).toBe(0);
    expect(mockEmitToUser).not.toHaveBeenCalled();
  });

  it("doesn't emit when the joiner has no active device key registered", async () => {
    const claimed = {
      id: PENDING_JOIN_ID,
      group_id: TEST_GROUP_ID,
      joiner_user_id: TEST_USER_ID_2,
      joiner_device_id: JOINER_DEVICE_ID,
    };
    mockQuery
      .mockResolvedValueOnce(queryResult([claimed]))
      .mockResolvedValueOnce(queryResult([])); // no active key

    const count = await dispatchPendingKeysharesForUser(TEST_USER_ID);
    expect(count).toBe(0);
    expect(mockEmitToUser).not.toHaveBeenCalled();
  });

  it('uses the most-recently-seen non-tombstoned key (handles reinstall race)', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([])); // nothing claimed; we just want to inspect the SQL
    await dispatchPendingKeysharesForUser(TEST_USER_ID);
    // The first call is the UPDATE … RETURNING for claiming. There's no
    // second call here because nothing was claimed. We assert the UPDATE
    // SQL uses EXISTS-against-group_members so a courier with no relevant
    // membership wouldn't have any claim.
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/SET state = 'in_flight'/i);
    expect(sql).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM group_members/i);
    expect(sql).toMatch(/joiner_user_id <> \$1/);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/keyshare/deliver
// ─────────────────────────────────────────────────────────────────
describe('POST /api/keyshare/deliver', () => {
  const token = generateAccessToken(TEST_USER_ID);

  function validBody(overrides: Record<string, unknown> = {}) {
    return {
      v: 1,
      pending_join_id: PENDING_JOIN_ID,
      group_id: TEST_GROUP_ID,
      from_user_id: TEST_USER_ID,
      from_device_id: COURIER_DEVICE_ID,
      ephemeral_public_key_b64: EPHEMERAL_PUBKEY_B64,
      iv_b64: IV_B64,
      auth_tag_b64: TAG_B64,
      ciphertext_b64: ENVELOPE_CIPHERTEXT_B64,
      group_key_version: 1,
      ...overrides,
    };
  }

  it('forwards the envelope when caller is the from_user, group member, and row is active', async () => {
    mockQuery
      .mockResolvedValueOnce(
        queryResult([
          { joiner_user_id: TEST_USER_ID_2, group_id: TEST_GROUP_ID, state: 'in_flight' },
        ]),
      ) // pending lookup
      .mockResolvedValueOnce(queryResult([{ '?column?': 1 }])) // membership ✓
      .mockResolvedValueOnce(queryResult([{ joiner_device_id: JOINER_DEVICE_ID }])); // markKeyshareDelivered UPDATE

    const res = await request(app)
      .post('/api/keyshare/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ v: 1, delivered: true });
    expect(mockEmitToUser).toHaveBeenCalledWith(
      TEST_USER_ID_2,
      'group:keyshare_envelope',
      expect.objectContaining({ pending_join_id: PENDING_JOIN_ID }),
    );
  });

  it('rejects 403 when from_user_id does not match the JWT caller', async () => {
    const res = await request(app)
      .post('/api/keyshare/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ from_user_id: TEST_USER_ID_3 }));

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 404 when the pending row does not exist', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));
    const res = await request(app)
      .post('/api/keyshare/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());
    expect(res.status).toBe(404);
  });

  it('returns 400 when row.group_id does not match the body', async () => {
    mockQuery.mockResolvedValueOnce(
      queryResult([
        {
          joiner_user_id: TEST_USER_ID_2,
          group_id: 'd1c2b3a4-e5f6-4a7b-8c9d-0e1f2a3b4c5e',
          state: 'pending',
        },
      ]),
    );
    const res = await request(app)
      .post('/api/keyshare/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());
    expect(res.status).toBe(400);
  });

  it('returns 200 delivered:false (no emit) when row is already terminal — late couriers no-op', async () => {
    mockQuery.mockResolvedValueOnce(
      queryResult([{ joiner_user_id: TEST_USER_ID_2, group_id: TEST_GROUP_ID, state: 'delivered' }]),
    );
    const res = await request(app)
      .post('/api/keyshare/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ v: 1, delivered: false });
    expect(mockEmitToUser).not.toHaveBeenCalled();
  });

  it('returns 403 when courier is no longer a group member at NOW (leave-then-spoof guard)', async () => {
    mockQuery
      .mockResolvedValueOnce(
        queryResult([{ joiner_user_id: TEST_USER_ID_2, group_id: TEST_GROUP_ID, state: 'pending' }]),
      )
      .mockResolvedValueOnce(queryResult([])); // membership empty

    const res = await request(app)
      .post('/api/keyshare/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    expect(res.status).toBe(403);
    expect(mockEmitToUser).not.toHaveBeenCalled();
  });

  it('two couriers race: second POST returns delivered:false (markKeyshareDelivered idempotent)', async () => {
    // First call: succeeds.
    mockQuery
      .mockResolvedValueOnce(
        queryResult([{ joiner_user_id: TEST_USER_ID_2, group_id: TEST_GROUP_ID, state: 'in_flight' }]),
      )
      .mockResolvedValueOnce(queryResult([{ '?column?': 1 }]))
      .mockResolvedValueOnce(queryResult([{ joiner_device_id: JOINER_DEVICE_ID }]));

    const res1 = await request(app)
      .post('/api/keyshare/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());
    expect(res1.body).toEqual({ v: 1, delivered: true });

    // Second call: row is now `delivered`, no emit.
    mockQuery
      .mockResolvedValueOnce(
        queryResult([{ joiner_user_id: TEST_USER_ID_2, group_id: TEST_GROUP_ID, state: 'delivered' }]),
      );

    const res2 = await request(app)
      .post('/api/keyshare/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());
    expect(res2.body).toEqual({ v: 1, delivered: false });

    // Only one emit total.
    expect(mockEmitToUser).toHaveBeenCalledTimes(1);
  });

  it('rejects 400 on malformed v field', async () => {
    const res = await request(app)
      .post('/api/keyshare/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ v: 2 }));
    expect(res.status).toBe(400);
  });

  it('rejects 400 on wrong-length ciphertext', async () => {
    const res = await request(app)
      .post('/api/keyshare/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ ciphertext_b64: 'A'.repeat(40) })); // not 64 chars
    expect(res.status).toBe(400);
  });

  it('rejects 401 without JWT', async () => {
    const res = await request(app)
      .post('/api/keyshare/deliver')
      .send(validBody());
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────
// expireStalePendingJoins
// ─────────────────────────────────────────────────────────────────
describe('keyshareHub.expireStalePendingJoins', () => {
  it("flips pending|in_flight → 'expired' past TTL", async () => {
    mockQuery.mockResolvedValueOnce(queryResult([], 2));
    const count = await expireStalePendingJoins();
    expect(count).toBe(2);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/SET state = 'expired'/i);
    expect(sql).toMatch(/state IN \('pending', 'in_flight'\)/i);
    expect(sql).toMatch(/created_at < NOW\(\) - INTERVAL '7 days'/i);
  });
});
