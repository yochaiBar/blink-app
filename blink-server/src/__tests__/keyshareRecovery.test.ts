/**
 * Group-key recovery + regeneration tests (fixes the "no group key;
 * handshake required" dead-end).
 *
 * The original Phase 4 flow only ever couriered a group key at JOIN time.
 * A member who belongs to a multi-member group but has no local key (a
 * stalled/failed join, or a pre-migration group whose server-side key was
 * dropped) had no way to obtain it. These add two escape hatches, both
 * reusing the existing pending_joins + courier machinery:
 *
 *   keyshareHub.requestKeyshareRecovery — enqueue a pending row for the
 *     requester and nudge every ONLINE other member to courier.
 *   POST /api/keyshare/request          — member-authenticated entry point.
 *   POST /api/keyshare/reset            — admin bumps the group key version
 *     (regeneration); triggers a `group:key_rotated` fan-out so members
 *     pull the new key via the recovery path above.
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
import { requestKeyshareRecovery } from '../services/keyshareHub';
import { query } from '../config/database';
import { emitToUser, emitToGroup, isUserOnline } from '../socket';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockEmitToUser = emitToUser as jest.MockedFunction<typeof emitToUser>;
const mockEmitToGroup = emitToGroup as jest.MockedFunction<typeof emitToGroup>;
const mockIsUserOnline = isUserOnline as jest.MockedFunction<typeof isUserOnline>;

const app = createTestApp(keyshareRouter, '/api/keyshare');

const PENDING_JOIN_ID = '11111111-1111-4111-8111-111111111111';
const REQUESTER_DEVICE_ID = '21111111-1111-4111-8111-111111111111';
const JOINER_DEVICE_ID = '31111111-1111-4111-8111-111111111111';
const PUBKEY_B64 = 'A'.repeat(43) + '=';

// ─────────────────────────────────────────────────────────────────
// requestKeyshareRecovery (service)
// ─────────────────────────────────────────────────────────────────
describe('keyshareHub.requestKeyshareRecovery', () => {
  it('enqueues a pending row and nudges only ONLINE other members to courier', async () => {
    mockQuery
      // enqueueKeyshare INSERT … RETURNING id
      .mockResolvedValueOnce(queryResult([{ id: PENDING_JOIN_ID }]))
      // other-members lookup
      .mockResolvedValueOnce(
        queryResult([{ user_id: TEST_USER_ID_2 }, { user_id: TEST_USER_ID_3 }]),
      )
      // dispatchPendingKeysharesForUser(user2): claim UPDATE … RETURNING
      .mockResolvedValueOnce(
        queryResult([
          {
            id: PENDING_JOIN_ID,
            group_id: TEST_GROUP_ID,
            joiner_user_id: TEST_USER_ID,
            joiner_device_id: JOINER_DEVICE_ID,
          },
        ]),
      )
      // dispatch: joiner pubkey lookup
      .mockResolvedValueOnce(
        queryResult([{ device_id: JOINER_DEVICE_ID, x25519_public_key: PUBKEY_B64 }]),
      );

    // user2 online, user3 offline
    mockIsUserOnline.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await requestKeyshareRecovery({
      groupId: TEST_GROUP_ID,
      requesterUserId: TEST_USER_ID,
      requesterDeviceId: REQUESTER_DEVICE_ID,
    });

    expect(result.enqueued).toBe(true);
    expect(result.couriersNotified).toBe(1);

    // enqueue used the requester as the joiner
    const enqueueSql = String(mockQuery.mock.calls[0][0]);
    expect(enqueueSql).toMatch(/INSERT INTO pending_joins/i);
    expect(mockQuery.mock.calls[0][1]).toEqual([
      TEST_GROUP_ID,
      TEST_USER_ID,
      REQUESTER_DEVICE_ID,
    ]);

    // other-members lookup excludes the requester
    const membersSql = String(mockQuery.mock.calls[1][0]);
    expect(membersSql).toMatch(/FROM group_members/i);
    expect(membersSql).toMatch(/user_id <> \$2/);
    expect(mockQuery.mock.calls[1][1]).toEqual([TEST_GROUP_ID, TEST_USER_ID]);

    // exactly one courier nudged (the online one)
    expect(mockEmitToUser).toHaveBeenCalledTimes(1);
    expect(mockEmitToUser).toHaveBeenCalledWith(
      TEST_USER_ID_2,
      'group:keyshare_request',
      expect.objectContaining({ group_id: TEST_GROUP_ID, pending_join_id: PENDING_JOIN_ID }),
    );
  });

  it('still enqueues when nobody else is online (couriersNotified 0)', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([{ id: PENDING_JOIN_ID }]))
      .mockResolvedValueOnce(queryResult([{ user_id: TEST_USER_ID_2 }]));
    mockIsUserOnline.mockResolvedValueOnce(false);

    const result = await requestKeyshareRecovery({
      groupId: TEST_GROUP_ID,
      requesterUserId: TEST_USER_ID,
      requesterDeviceId: REQUESTER_DEVICE_ID,
    });

    expect(result.enqueued).toBe(true);
    expect(result.couriersNotified).toBe(0);
    expect(mockEmitToUser).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/keyshare/request
// ─────────────────────────────────────────────────────────────────
describe('POST /api/keyshare/request', () => {
  const token = generateAccessToken(TEST_USER_ID);

  function validBody(overrides: Record<string, unknown> = {}) {
    return { v: 1, group_id: TEST_GROUP_ID, device_id: REQUESTER_DEVICE_ID, ...overrides };
  }

  it('enqueues recovery when the caller is a group member', async () => {
    mockQuery
      // membership check
      .mockResolvedValueOnce(queryResult([{ '?column?': 1 }]))
      // enqueueKeyshare
      .mockResolvedValueOnce(queryResult([{ id: PENDING_JOIN_ID }]))
      // other members (none) → no dispatch
      .mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post('/api/keyshare/request')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ v: 1, enqueued: true, couriers_notified: 0 });
  });

  it('rejects 403 when the caller is not a member of the group', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([])); // membership empty

    const res = await request(app)
      .post('/api/keyshare/request')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    expect(res.status).toBe(403);
    expect(mockEmitToUser).not.toHaveBeenCalled();
  });

  it('rejects 400 on malformed body (bad device_id)', async () => {
    const res = await request(app)
      .post('/api/keyshare/request')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ device_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects 401 without JWT', async () => {
    const res = await request(app).post('/api/keyshare/request').send(validBody());
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/keyshare/reset  (regeneration — admin only)
// ─────────────────────────────────────────────────────────────────
describe('POST /api/keyshare/reset', () => {
  const token = generateAccessToken(TEST_USER_ID);

  function validBody(overrides: Record<string, unknown> = {}) {
    return { v: 1, group_id: TEST_GROUP_ID, ...overrides };
  }

  it('bumps the group key version and fans out key_rotated when caller is admin', async () => {
    mockQuery
      // role check
      .mockResolvedValueOnce(queryResult([{ role: 'admin' }]))
      // version bump UPDATE … RETURNING
      .mockResolvedValueOnce(queryResult([{ group_key_version: 2 }]));

    const res = await request(app)
      .post('/api/keyshare/reset')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ v: 1, group_key_version: 2 });

    const bumpSql = String(mockQuery.mock.calls[1][0]);
    expect(bumpSql).toMatch(/UPDATE groups/i);
    expect(bumpSql).toMatch(/group_key_version = group_key_version \+ 1/i);

    expect(mockEmitToGroup).toHaveBeenCalledWith(
      TEST_GROUP_ID,
      'group:key_rotated',
      expect.objectContaining({ group_id: TEST_GROUP_ID, group_key_version: 2 }),
    );
  });

  it('rejects 403 when caller is a non-admin member', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([{ role: 'member' }]));

    const res = await request(app)
      .post('/api/keyshare/reset')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    expect(res.status).toBe(403);
    expect(mockEmitToGroup).not.toHaveBeenCalled();
  });

  it('rejects 403 when caller is not in the group at all', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post('/api/keyshare/reset')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    expect(res.status).toBe(403);
  });

  it('rejects 401 without JWT', async () => {
    const res = await request(app).post('/api/keyshare/reset').send(validBody());
    expect(res.status).toBe(401);
  });
});
