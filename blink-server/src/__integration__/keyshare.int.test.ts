/**
 * Group-key courier handshake (protocol v2) with real Socket.io peers: who
 * is asked to courier and when, who may deliver, leaving mid-handshake,
 * and the two-step reset.
 */
import type { Socket as ClientSocket } from 'socket.io-client';
import crypto from 'crypto';
import { query } from '../config/database';
import { reapOldPendingJoins } from '../services/keyshareHub';
import { useTestServer } from './support/server';
import {
  TestUser,
  addMember,
  bearer,
  countRows,
  createChallenge,
  createGroup,
  createResponse,
  createUser,
  holdKey,
  registerDeviceKey,
} from './support/factories';
import type { KeyRotatedEvent, KeyshareEnvelope, KeyshareRequest } from '../shared/photoProtocol';

const server = useTestServer();

/** Connect `user`, collecting the keyshare requests and rotation events it receives. */
async function online(user: TestUser, deviceId?: string) {
  const socket: ClientSocket = await server.connectSocket(user.token, deviceId ? { deviceId } : {});
  const requests: KeyshareRequest[] = [];
  const envelopes: KeyshareEnvelope[] = [];
  const rotations: KeyRotatedEvent[] = [];
  socket.on('group:keyshare_request', (r: KeyshareRequest) => requests.push(r));
  socket.on('group:keyshare_envelope', (e: KeyshareEnvelope) => envelopes.push(e));
  socket.on('group:key_rotated', (e: KeyRotatedEvent) => rotations.push(e));
  return { socket, requests, envelopes, rotations };
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met in time');
}

/** Give fire-and-forget dispatches a chance to (wrongly) happen. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

function deliverBody(request: KeyshareRequest, overrides: Record<string, unknown> = {}) {
  return {
    v: 2,
    pending_join_id: request.pending_join_id,
    from_device_id: crypto.randomUUID(),
    key_version: request.key_version,
    ephemeral_public_key_b64: crypto.randomBytes(32).toString('base64'),
    iv_b64: crypto.randomBytes(12).toString('base64'),
    ciphertext_b64: crypto.randomBytes(48).toString('base64'),
    ...overrides,
  };
}

/** Alice (admin) holds the key at v1; Bob has a registered device and isn't in the group yet. */
async function scene() {
  const alice = await createUser({ display_name: 'Alice' });
  const bob = await createUser({ display_name: 'Bob' });
  const group = await createGroup({ createdBy: alice });
  await holdKey(group.id, alice);
  const bobKey = await registerDeviceKey(bob);
  return { alice, bob, group, bobDevice: bobKey.deviceId, bobPublicKey: bobKey.publicKeyB64 };
}

const join = (user: TestUser, inviteCode: string, deviceId: string) =>
  server.api().post('/api/groups/join').set(bearer(user)).send({ invite_code: inviteCode, device_id: deviceId });

const pendingJoinsOf = (userId: string) =>
  countRows('SELECT COUNT(*) FROM pending_joins WHERE joiner_user_id = $1', [userId]);

async function claimOf(joinerId: string) {
  const row = await query<{ courier_user_id: string | null; lease_expires_at: Date | null }>(
    'SELECT courier_user_id, lease_expires_at FROM pending_joins WHERE joiner_user_id = $1',
    [joinerId],
  );
  return row.rows[0];
}

async function keyVersionOf(groupId: string, userId: string): Promise<number | null> {
  const row = await query<{ key_version: number | null }>(
    'SELECT key_version FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  return row.rows[0].key_version;
}

describe('keyshare — courier handshake', () => {
  it('a key holder couriers the key to the joiner’s device only; confirming ends the join', async () => {
    const { alice, bob, group, bobDevice, bobPublicKey } = await scene();
    const aliceOnline = await online(alice);
    const bobPhone = await online(bob, bobDevice);
    const bobTablet = await online(bob, crypto.randomUUID());

    expect((await join(bob, group.invite_code, bobDevice)).status).toBe(200);

    await until(() => aliceOnline.requests.length === 1);
    const request = aliceOnline.requests[0];
    expect(request).toEqual({
      v: 2,
      pending_join_id: expect.any(String),
      group_id: group.id,
      joiner_user_id: bob.id,
      joiner_device_id: bobDevice,
      joiner_x25519_public_key_b64: bobPublicKey,
      key_version: 1,
    });

    const delivered = await server.api().post('/api/keyshare/deliver').set(bearer(alice)).send(deliverBody(request));
    expect(delivered.status).toBe(200);
    expect(delivered.body).toEqual({ v: 2, delivered: true });
    await until(() => bobPhone.envelopes.length === 1);
    expect(bobPhone.envelopes[0]).toMatchObject({
      v: 2,
      pending_join_id: request.pending_join_id,
      group_id: group.id,
      from_user_id: alice.id,
      key_version: 1,
    });
    await settle();
    expect(bobTablet.envelopes).toHaveLength(0);

    // The join lasts until Bob's device says it holds the key.
    expect(await pendingJoinsOf(bob.id)).toBe(1);
    const confirmed = await server
      .api()
      .post('/api/keyshare/confirm')
      .set(bearer(bob))
      .send({ v: 2, group_id: group.id, key_version: 1 });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual({ v: 2, key_version: 1 });
    expect(await pendingJoinsOf(bob.id)).toBe(0);
    expect(await keyVersionOf(group.id, bob.id)).toBe(1);
  });

  it('asks only a holder of the current version, and only while the joiner’s device is online', async () => {
    const { alice, bob, group, bobDevice } = await scene();
    const carol = await createUser();
    await addMember(group.id, carol.id); // a member without the key
    const carolOnline = await online(carol);

    // Bob joins with his device offline: nothing goes out yet.
    expect((await join(bob, group.invite_code, bobDevice)).status).toBe(200);
    await online(bob, bobDevice);
    await settle();
    expect(carolOnline.requests).toHaveLength(0);
    expect((await claimOf(bob.id)).courier_user_id).toBeNull();

    // A holder comes online: the join is claimed for her.
    const aliceOnline = await online(alice);
    await until(() => aliceOnline.requests.length === 1);
    expect((await claimOf(bob.id)).courier_user_id).toBe(alice.id);
    expect(carolOnline.requests).toHaveLength(0);
  });

  it('re-offers a join whose lease lapsed without an envelope', async () => {
    const { alice, bob, group, bobDevice } = await scene();
    await online(bob, bobDevice);
    const first = await online(alice);
    await join(bob, group.invite_code, bobDevice);
    await until(() => first.requests.length === 1);

    // Still leased: a reconnect doesn't offer it again.
    const second = await online(alice);
    await settle();
    expect(second.requests).toHaveLength(0);

    await query(`UPDATE pending_joins SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE joiner_user_id = $1`, [
      bob.id,
    ]);
    const third = await online(alice);
    await until(() => third.requests.length + second.requests.length >= 1);
  });
});

describe('keyshare — deliver', () => {
  async function claimed() {
    const s = await scene();
    const dave = await createUser();
    await addMember(s.group.id, dave.id);
    await holdKey(s.group.id, dave);
    await online(s.bob, s.bobDevice);
    const aliceOnline = await online(s.alice);
    await join(s.bob, s.group.invite_code, s.bobDevice);
    await until(() => aliceOnline.requests.length === 1);
    return { ...s, dave, request: aliceOnline.requests[0] };
  }

  it('accepts an envelope only from the courier the join is claimed for', async () => {
    const { dave, request } = await claimed();
    const stranger = await createUser();

    for (const user of [dave, stranger]) {
      const res = await server.api().post('/api/keyshare/deliver').set(bearer(user)).send(deliverBody(request));
      expect(res.status).toBe(403);
    }
    const unknown = deliverBody(request, { pending_join_id: crypto.randomUUID() });
    expect((await server.api().post('/api/keyshare/deliver').set(bearer(dave)).send(unknown)).status).toBe(404);
    const v1 = deliverBody(request, { v: 1 });
    expect((await server.api().post('/api/keyshare/deliver').set(bearer(dave)).send(v1)).status).toBe(400);
  });

  it('answers 409 for a key version that isn’t the group’s current one', async () => {
    const { alice, request } = await claimed();
    const stale = deliverBody(request, { key_version: 2 });
    const res = await server.api().post('/api/keyshare/deliver').set(bearer(alice)).send(stale);
    expect(res.status).toBe(409);
  });
});

describe('keyshare — leaving mid-handshake', () => {
  it('the joiner leaving drops the join; a late envelope is 404', async () => {
    const { alice, bob, group, bobDevice } = await scene();
    await online(bob, bobDevice);
    const aliceOnline = await online(alice);
    await join(bob, group.invite_code, bobDevice);
    await until(() => aliceOnline.requests.length === 1);

    expect((await server.api().post(`/api/groups/${group.id}/leave`).set(bearer(bob))).status).toBe(200);

    expect(await pendingJoinsOf(bob.id)).toBe(0);
    const late = deliverBody(aliceOnline.requests[0]);
    expect((await server.api().post('/api/keyshare/deliver').set(bearer(alice)).send(late)).status).toBe(404);
  });

  it('the courier leaving frees the claim for another holder and drops their photo pickups', async () => {
    const { alice, bob, group, bobDevice } = await scene();
    const dave = await createUser();
    await addMember(group.id, dave.id);
    await holdKey(group.id, dave);
    const challenge = await createChallenge({ groupId: group.id, createdBy: alice });
    const response = await createResponse({ challengeId: challenge.id, user: alice });
    await query(
      `INSERT INTO pending_photo_pickups
         (response_id, challenge_id, group_id, recipient_user_id, sender_user_id, sender_device_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [response.id, challenge.id, group.id, dave.id, alice.id, crypto.randomUUID()],
    );
    await online(bob, bobDevice);
    const aliceOnline = await online(alice);
    await join(bob, group.invite_code, bobDevice);
    await until(() => aliceOnline.requests.length === 1);

    expect((await server.api().post(`/api/groups/${group.id}/leave`).set(bearer(alice))).status).toBe(200);

    expect(await claimOf(bob.id)).toEqual({ courier_user_id: null, lease_expires_at: null });
    expect(await countRows('SELECT COUNT(*) FROM pending_photo_pickups WHERE group_id = $1', [group.id])).toBe(0);
    const daveOnline = await online(dave);
    await until(() => daveOnline.requests.length === 1);
    const late = deliverBody(aliceOnline.requests[0]);
    expect((await server.api().post('/api/keyshare/deliver').set(bearer(alice)).send(late)).status).toBe(403);
  });

  it('deleting the courier’s account frees the claim', async () => {
    const { alice, bob, group, bobDevice } = await scene();
    await addMember(group.id, (await createUser()).id);
    await online(bob, bobDevice);
    const aliceOnline = await online(alice);
    await join(bob, group.invite_code, bobDevice);
    await until(() => aliceOnline.requests.length === 1);

    expect((await server.api().delete('/api/auth/delete-account').set(bearer(alice))).status).toBe(200);

    expect(await claimOf(bob.id)).toEqual({ courier_user_id: null, lease_expires_at: null });
  });
});

describe('keyshare — reset', () => {
  it('members hear of a reset only once the admin holds the new key, and ask only her', async () => {
    const { alice, bob, group, bobDevice } = await scene();
    await addMember(group.id, bob.id);
    await holdKey(group.id, bob);
    const aliceOnline = await online(alice);
    const bobOnline = await online(bob, bobDevice);

    const notAdmin = await server.api().post('/api/keyshare/reset').set(bearer(bob)).send({ v: 2, group_id: group.id });
    expect(notAdmin.status).toBe(403);
    const reset = await server.api().post('/api/keyshare/reset').set(bearer(alice)).send({ v: 2, group_id: group.id });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ v: 2, group_key_version: 2 });

    // Nobody holds v2 yet: no rotation event, and Bob's request waits.
    const asked = await server
      .api()
      .post('/api/keyshare/request')
      .set(bearer(bob))
      .send({ v: 2, group_id: group.id, device_id: bobDevice });
    expect(asked.status).toBe(200);
    expect(asked.body).toEqual({ v: 2, enqueued: true, couriers_notified: 0 });
    await settle();
    expect(bobOnline.rotations).toHaveLength(0);
    expect(aliceOnline.requests).toHaveLength(0);

    const stale = await server
      .api()
      .post('/api/keyshare/confirm')
      .set(bearer(alice))
      .send({ v: 2, group_id: group.id, key_version: 1 });
    expect(stale.status).toBe(409);
    const confirmed = await server
      .api()
      .post('/api/keyshare/confirm')
      .set(bearer(alice))
      .send({ v: 2, group_id: group.id, key_version: 2 });
    expect(confirmed.status).toBe(200);

    await until(() => bobOnline.rotations.length === 1 && aliceOnline.requests.length === 1);
    expect(bobOnline.rotations[0]).toEqual({ v: 2, group_id: group.id, group_key_version: 2 });
    expect(aliceOnline.requests[0]).toMatchObject({ joiner_user_id: bob.id, key_version: 2 });

    // Confirming again announces nothing new.
    await server
      .api()
      .post('/api/keyshare/confirm')
      .set(bearer(alice))
      .send({ v: 2, group_id: group.id, key_version: 2 });
    await settle();
    expect(bobOnline.rotations).toHaveLength(1);
  });

  it('only the admin who reset can introduce the new key; members confirm it after her', async () => {
    const { alice, bob, group } = await scene();
    const carol = await createUser();
    await addMember(group.id, bob.id);
    await addMember(group.id, carol.id, 'admin');
    await holdKey(group.id, bob);
    await holdKey(group.id, carol);
    const bobOnline = await online(bob);
    const confirm = (user: TestUser, keyVersion: number) =>
      server
        .api()
        .post('/api/keyshare/confirm')
        .set(bearer(user))
        .send({ v: 2, group_id: group.id, key_version: keyVersion });

    await server.api().post('/api/keyshare/reset').set(bearer(alice)).send({ v: 2, group_id: group.id });

    // A key Bob (or co-admin Carol) minted themselves must not become v2.
    expect((await confirm(bob, 2)).status).toBe(403);
    expect((await confirm(carol, 2)).status).toBe(403);
    await settle();
    expect(bobOnline.rotations).toHaveLength(0);
    expect(await keyVersionOf(group.id, bob.id)).toBe(1);

    expect((await confirm(alice, 2)).status).toBe(200);
    await until(() => bobOnline.rotations.length === 1);
    expect((await confirm(bob, 2)).status).toBe(200);
    expect(await keyVersionOf(group.id, bob.id)).toBe(2);
    await settle();
    expect(bobOnline.rotations).toHaveLength(1);
  });

  it('a version nobody holds yet can only be introduced by an admin, e.g. the creator at v1', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const confirm = (user: TestUser) =>
      server.api().post('/api/keyshare/confirm').set(bearer(user)).send({ v: 2, group_id: group.id, key_version: 1 });

    expect((await confirm(bob)).status).toBe(403);
    expect((await confirm(alice)).status).toBe(200);
    expect((await confirm(bob)).status).toBe(200);
    // Re-confirming a version you hold is always fine.
    expect((await confirm(bob)).status).toBe(200);
  });

  it('a reset frees claims made under the old version', async () => {
    const { alice, bob, group, bobDevice } = await scene();
    await online(bob, bobDevice);
    const aliceOnline = await online(alice);
    await join(bob, group.invite_code, bobDevice);
    await until(() => aliceOnline.requests.length === 1);

    await server.api().post('/api/keyshare/reset').set(bearer(alice)).send({ v: 2, group_id: group.id });

    expect(await claimOf(bob.id)).toEqual({ courier_user_id: null, lease_expires_at: null });
    const late = deliverBody(aliceOnline.requests[0]);
    expect((await server.api().post('/api/keyshare/deliver').set(bearer(alice)).send(late)).status).toBe(403);
  });
});

describe('keyshare — request, confirm and reaping', () => {
  it('request and confirm need membership; a request stops the requester counting as a holder', async () => {
    const { alice, group } = await scene();
    const stranger = await createUser();
    const device = crypto.randomUUID();

    const strangerAsks = await server
      .api()
      .post('/api/keyshare/request')
      .set(bearer(stranger))
      .send({ v: 2, group_id: group.id, device_id: device });
    expect(strangerAsks.status).toBe(403);
    const strangerConfirms = await server
      .api()
      .post('/api/keyshare/confirm')
      .set(bearer(stranger))
      .send({ v: 2, group_id: group.id, key_version: 1 });
    expect(strangerConfirms.status).toBe(403);
    const badDevice = await server
      .api()
      .post('/api/keyshare/request')
      .set(bearer(alice))
      .send({ v: 2, group_id: group.id, device_id: 'nope' });
    expect(badDevice.status).toBe(400);

    const asks = await server
      .api()
      .post('/api/keyshare/request')
      .set(bearer(alice))
      .send({ v: 2, group_id: group.id, device_id: device });
    expect(asks.status).toBe(200);
    expect(await keyVersionOf(group.id, alice.id)).toBeNull();
    expect(await pendingJoinsOf(alice.id)).toBe(1);
  });

  it('reaps pending joins older than 7 days', async () => {
    const { bob, group, bobDevice } = await scene();
    await join(bob, group.invite_code, bobDevice);
    await query(`UPDATE pending_joins SET created_at = NOW() - INTERVAL '8 days' WHERE joiner_user_id = $1`, [bob.id]);

    expect(await reapOldPendingJoins()).toBe(1);
    expect(await pendingJoinsOf(bob.id)).toBe(0);
  });
});
