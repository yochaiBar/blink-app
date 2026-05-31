/**
 * Photo relay route + relayHub tests — E2E photo flow Phase 3.
 *
 * Covers:
 *   POST /api/photos/relay route — validation, happy fan-out, queue-on-offline
 *   relayHub.dispatchPhoto       — membership filter, block-list filter,
 *                                  pickup_id ACK on terminal delivery
 *   relayHub.dispatchPendingPickupsForUser — atomic pending→in_flight claim,
 *                                  emit pickup_request to sender device
 *   relayHub.expireStalePendingPickups     — TTL flip
 *
 * Crypto isn't exercised here (it's tested in groupCrypto.test.ts).
 * Bytes pass through the route as opaque base64; that's fine — the route's
 * job is "validate → call dispatchPhoto", not "understand ciphertext."
 */

import request from 'supertest';
import {
  createTestApp,
  generateAccessToken,
  TEST_USER_ID,
  TEST_USER_ID_2,
  TEST_USER_ID_3,
  TEST_GROUP_ID,
  TEST_CHALLENGE_ID,
  TEST_RESPONSE_ID,
  queryResult,
} from './helpers';

import './setup';

import photoRelayRouter from '../routes/photos/relay';
import {
  dispatchPendingPickupsForUser,
  expireStalePendingPickups,
} from '../services/relayHub';
import { query } from '../config/database';
import {
  emitToUserDevice,
  emitToUserWithAck,
  isUserOnline,
} from '../socket';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockIsUserOnline = isUserOnline as jest.MockedFunction<typeof isUserOnline>;
const mockEmitWithAck = emitToUserWithAck as jest.MockedFunction<
  typeof emitToUserWithAck
>;
const mockEmitToUserDevice = emitToUserDevice as jest.MockedFunction<
  typeof emitToUserDevice
>;

const app = createTestApp(photoRelayRouter, '/api/photos');

const TEST_DEVICE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';

// Canonical valid base64 strings of the right lengths. 12 bytes is divisible
// by 3 so the encoding has NO padding; 16 bytes has 2 padding chars.
const IV_B64 = 'AAAAAAAAAAAAAAAA';            // 16 chars (12 bytes, no padding)
const TAG_B64 = 'AAAAAAAAAAAAAAAAAAAAAA=='; // 22 chars + '==' (16 bytes)
const CIPHERTEXT_B64 = 'YWJjZA==';            // "abcd" — any small valid base64 works

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    group_id: TEST_GROUP_ID,
    challenge_id: TEST_CHALLENGE_ID,
    response_id: TEST_RESPONSE_ID,
    sender_device_id: TEST_DEVICE_ID,
    iv_b64: IV_B64,
    auth_tag_b64: TAG_B64,
    recipient_user_ids: [TEST_USER_ID_2],
    ciphertext_b64: CIPHERTEXT_B64,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// POST /api/photos/relay — body validation
// ─────────────────────────────────────────────────────────────────
describe('POST /api/photos/relay — validation', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('rejects with 400 when v is not 1', async () => {
    const res = await request(app)
      .post('/api/photos/relay')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ v: 2 }));
    expect(res.status).toBe(400);
  });

  it('rejects with 400 on bad IV length', async () => {
    const res = await request(app)
      .post('/api/photos/relay')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ iv_b64: 'AAA=' }));
    expect(res.status).toBe(400);
  });

  it('rejects with 400 on empty recipient list', async () => {
    const res = await request(app)
      .post('/api/photos/relay')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ recipient_user_ids: [] }));
    expect(res.status).toBe(400);
  });

  it('rejects with 400 on too many recipients (>64)', async () => {
    const many = Array.from({ length: 65 }, (_, i) =>
      `00000000-0000-4000-8000-${(i + 1).toString().padStart(12, '0')}`,
    );
    const res = await request(app)
      .post('/api/photos/relay')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ recipient_user_ids: many }));
    expect(res.status).toBe(400);
  });

  it('rejects with 401 when no JWT', async () => {
    const res = await request(app).post('/api/photos/relay').send(validBody());
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/photos/relay — fan-out behavior via dispatchPhoto
// ─────────────────────────────────────────────────────────────────
describe('POST /api/photos/relay — dispatch', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('delivers to a single online recipient (membership + ack OK)', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([{ user_id: TEST_USER_ID_2 }])) // members
      .mockResolvedValueOnce(queryResult([])); // blocks
    mockIsUserOnline.mockResolvedValueOnce(true);
    mockEmitWithAck.mockResolvedValueOnce({ acked: 1, nacked: 0, failed: 0 });

    const res = await request(app)
      .post('/api/photos/relay')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    expect(res.status).toBe(200);
    expect(res.body.delivered_user_ids).toEqual([TEST_USER_ID_2]);
    expect(res.body.queued_user_ids).toEqual([]);
    expect(mockEmitWithAck).toHaveBeenCalledWith(
      TEST_USER_ID_2,
      'photo:incoming',
      expect.objectContaining({
        v: 1,
        group_id: TEST_GROUP_ID,
        response_id: TEST_RESPONSE_ID,
        sender_user_id: TEST_USER_ID,
        iv_b64: IV_B64,
        ciphertext_b64: CIPHERTEXT_B64,
      }),
      30_000,
    );
  });

  it('queues an offline recipient and returns them in queued_user_ids', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([{ user_id: TEST_USER_ID_2 }])) // members
      .mockResolvedValueOnce(queryResult([])) // blocks
      .mockResolvedValueOnce(queryResult([])); // INSERT pending row
    mockIsUserOnline.mockResolvedValueOnce(false);

    const res = await request(app)
      .post('/api/photos/relay')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    expect(res.status).toBe(200);
    expect(res.body.delivered_user_ids).toEqual([]);
    expect(res.body.queued_user_ids).toEqual([TEST_USER_ID_2]);
    expect(mockEmitWithAck).not.toHaveBeenCalled();
    // Find the INSERT pending call (might be 3rd or 4th depending on ordering).
    const insertCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).match(/INSERT INTO pending_photo_pickups/i),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual([
      TEST_RESPONSE_ID,
      TEST_CHALLENGE_ID,
      TEST_USER_ID_2,
      TEST_USER_ID,
      TEST_DEVICE_ID,
      TEST_GROUP_ID,
    ]);
  });

  it('queues an online recipient whose socket NACKed (no successful ack)', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([{ user_id: TEST_USER_ID_2 }]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]));
    mockIsUserOnline.mockResolvedValueOnce(true);
    mockEmitWithAck.mockResolvedValueOnce({ acked: 0, nacked: 1, failed: 0 });

    const res = await request(app)
      .post('/api/photos/relay')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    expect(res.status).toBe(200);
    expect(res.body.delivered_user_ids).toEqual([]);
    expect(res.body.queued_user_ids).toEqual([TEST_USER_ID_2]);
  });

  it('drops non-members silently (defense in depth — sender lied about who is in the group)', async () => {
    // Sender claims to relay to USER_2 + USER_3, but only USER_2 is a member.
    mockQuery
      .mockResolvedValueOnce(queryResult([{ user_id: TEST_USER_ID_2 }])) // only USER_2 returned
      .mockResolvedValueOnce(queryResult([])); // no blocks
    mockIsUserOnline.mockResolvedValueOnce(true);
    mockEmitWithAck.mockResolvedValueOnce({ acked: 1, nacked: 0, failed: 0 });

    const res = await request(app)
      .post('/api/photos/relay')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ recipient_user_ids: [TEST_USER_ID_2, TEST_USER_ID_3] }));

    expect(res.status).toBe(200);
    expect(res.body.delivered_user_ids).toEqual([TEST_USER_ID_2]);
    expect(res.body.queued_user_ids).toEqual([]);
    // USER_3 was silently dropped — never appears in any emit or queue.
    expect(mockEmitWithAck).toHaveBeenCalledTimes(1);
  });

  it('drops blocked recipients (symmetric: either direction)', async () => {
    mockQuery
      .mockResolvedValueOnce(
        queryResult([
          { user_id: TEST_USER_ID_2 },
          { user_id: TEST_USER_ID_3 },
        ]),
      )
      .mockResolvedValueOnce(
        // Sender blocked USER_3 → drop USER_3
        queryResult([{ blocker_id: TEST_USER_ID, blocked_id: TEST_USER_ID_3 }]),
      );
    mockIsUserOnline.mockResolvedValueOnce(true);
    mockEmitWithAck.mockResolvedValueOnce({ acked: 1, nacked: 0, failed: 0 });

    const res = await request(app)
      .post('/api/photos/relay')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ recipient_user_ids: [TEST_USER_ID_2, TEST_USER_ID_3] }));

    expect(res.status).toBe(200);
    expect(res.body.delivered_user_ids).toEqual([TEST_USER_ID_2]);
    expect(res.body.queued_user_ids).toEqual([]);
  });

  it('removes the sender from the recipient list (defensive)', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([{ user_id: TEST_USER_ID_2 }]))
      .mockResolvedValueOnce(queryResult([]));
    mockIsUserOnline.mockResolvedValueOnce(true);
    mockEmitWithAck.mockResolvedValueOnce({ acked: 1, nacked: 0, failed: 0 });

    const res = await request(app)
      .post('/api/photos/relay')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ recipient_user_ids: [TEST_USER_ID, TEST_USER_ID_2] }));

    expect(res.status).toBe(200);
    expect(res.body.delivered_user_ids).toEqual([TEST_USER_ID_2]);
    // Sender is never in either list.
    expect(res.body.queued_user_ids).not.toContain(TEST_USER_ID);
  });

  it('ACKs the pickup row when pickup_id is provided', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([{ user_id: TEST_USER_ID_2 }]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([])); // ACK pending UPDATE
    mockIsUserOnline.mockResolvedValueOnce(true);
    mockEmitWithAck.mockResolvedValueOnce({ acked: 1, nacked: 0, failed: 0 });

    const PICKUP_ID = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
    const res = await request(app)
      .post('/api/photos/relay')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ pickup_id: PICKUP_ID }));

    expect(res.status).toBe(200);
    const ackCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).match(/UPDATE pending_photo_pickups\s+SET state = 'acked'/i),
    );
    expect(ackCall).toBeDefined();
    expect(ackCall![1]).toEqual([PICKUP_ID]);
  });
});

// ─────────────────────────────────────────────────────────────────
// relayHub.dispatchPendingPickupsForUser — pickup_request emit
// ─────────────────────────────────────────────────────────────────
describe('relayHub.dispatchPendingPickupsForUser', () => {
  it('claims pending rows and emits pickup_request per row', async () => {
    const pickup1 = {
      id: 'p1111111-1111-4111-8111-111111111111',
      response_id: TEST_RESPONSE_ID,
      group_id: TEST_GROUP_ID,
      sender_user_id: TEST_USER_ID,
      sender_device_id: TEST_DEVICE_ID,
    };
    const pickup2 = {
      id: 'p2222222-2222-4222-8222-222222222222',
      response_id: 'r2222222-2222-4222-8222-222222222222',
      group_id: TEST_GROUP_ID,
      sender_user_id: TEST_USER_ID_3,
      sender_device_id: TEST_DEVICE_ID,
    };
    mockQuery.mockResolvedValueOnce(queryResult([pickup1, pickup2]));

    const count = await dispatchPendingPickupsForUser(TEST_USER_ID_2);

    expect(count).toBe(2);
    expect(mockEmitToUserDevice).toHaveBeenCalledTimes(2);
    expect(mockEmitToUserDevice).toHaveBeenNthCalledWith(
      1,
      TEST_USER_ID,
      TEST_DEVICE_ID,
      'photo:pickup_request',
      expect.objectContaining({
        v: 1,
        response_id: TEST_RESPONSE_ID,
        recipient_user_id: TEST_USER_ID_2,
        pickup_id: pickup1.id,
      }),
    );
  });

  it('returns 0 when nothing is pending', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));
    const count = await dispatchPendingPickupsForUser(TEST_USER_ID_2);
    expect(count).toBe(0);
    expect(mockEmitToUserDevice).not.toHaveBeenCalled();
  });

  it('uses an atomic UPDATE...RETURNING to flip pending → in_flight', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));
    await dispatchPendingPickupsForUser(TEST_USER_ID_2);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/UPDATE pending_photo_pickups/i);
    expect(sql).toMatch(/SET state = 'in_flight'/i);
    expect(sql).toMatch(/WHERE recipient_user_id = \$1 AND state = 'pending'/i);
    expect(sql).toMatch(/RETURNING/i);
  });
});

// ─────────────────────────────────────────────────────────────────
// relayHub.expireStalePendingPickups
// ─────────────────────────────────────────────────────────────────
describe('relayHub.expireStalePendingPickups', () => {
  it("flips pending|in_flight → 'expired' past TTL", async () => {
    mockQuery.mockResolvedValueOnce(queryResult([], 3));
    const count = await expireStalePendingPickups();
    expect(count).toBe(3);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/SET state = 'expired'/i);
    expect(sql).toMatch(/state IN \('pending', 'in_flight'\)/i);
    expect(sql).toMatch(/created_at < NOW\(\) - INTERVAL '7 days'/i);
  });
});
