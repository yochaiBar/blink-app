/**
 * POST /api/photos/relay (protocol v2) with real Socket.io peers: who may
 * relay, who receives, pickups with leases, and server-managed rooms.
 */
import type { Socket as ClientSocket } from 'socket.io-client';
import crypto from 'crypto';
import { query } from '../config/database';
import { reapOldPickups } from '../services/relayHub';
import { useTestServer } from './support/server';
import {
  TestUser,
  addMember,
  bearer,
  block,
  countRows,
  createChallenge,
  createGroup,
  createResponse,
  createUser,
} from './support/factories';
import type { IncomingPhotoEnvelope, PhotoPickupRequest } from '../shared/photoProtocol';

const server = useTestServer();

/** Connect `user` as an online recipient that ACKs every photo:incoming. */
async function onlineRecipient(user: TestUser): Promise<{ socket: ClientSocket; received: IncomingPhotoEnvelope[] }> {
  const socket = await server.connectSocket(user.token);
  const received: IncomingPhotoEnvelope[] = [];
  socket.on('photo:incoming', (payload: IncomingPhotoEnvelope, ack: (r: { v: 2; ok: boolean }) => void) => {
    received.push(payload);
    ack({ v: 2, ok: true });
  });
  return { socket, received };
}

/** Connect `user` as the sender device `deviceId`, collecting pickup requests. */
async function senderDevice(user: TestUser, deviceId: string) {
  const socket = await server.connectSocket(user.token, { deviceId });
  const requests: PhotoPickupRequest[] = [];
  socket.on('photo:pickup_request', (r: PhotoPickupRequest) => requests.push(r));
  return { socket, requests };
}

function relayBody(opts: { responseId: string; deviceId?: string; keyVersion?: number; pickupId?: string }) {
  return {
    v: 2,
    response_id: opts.responseId,
    sender_device_id: opts.deviceId ?? crypto.randomUUID(),
    key_version: opts.keyVersion ?? 1,
    iv_b64: 'AAAAAAAAAAAAAAAA',
    ciphertext_b64: 'c2VjcmV0IHBob3Rv',
    ...(opts.pickupId ? { pickup_id: opts.pickupId } : {}),
  };
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met in time');
}

async function scene() {
  const alice = await createUser();
  const bob = await createUser();
  const group = await createGroup({ createdBy: alice, members: [bob] });
  const challenge = await createChallenge({ groupId: group.id, createdBy: alice });
  const response = await createResponse({ challengeId: challenge.id, user: alice });
  return { alice, bob, group, challenge, response };
}

const pickupsFor = (recipientId: string) =>
  countRows('SELECT COUNT(*) FROM pending_photo_pickups WHERE recipient_user_id = $1', [recipientId]);

describe('POST /api/photos/relay — who may relay', () => {
  it('delivers the author’s photo to the online audience, with a v2 envelope', async () => {
    const { alice, bob, group, challenge, response } = await scene();
    const bobOnline = await onlineRecipient(bob);

    const res = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ responseId: response.id }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ v: 2, delivered_user_ids: [bob.id], queued_user_ids: [] });
    expect(bobOnline.received).toEqual([
      expect.objectContaining({
        v: 2,
        group_id: group.id,
        challenge_id: challenge.id,
        response_id: response.id,
        sender_user_id: alice.id,
        key_version: 1,
      }),
    ]);
  });

  // Was KNOWN BUG (c) until Stage 3a: the relay now derives the group from
  // the response and requires the caller to own it and be a member.
  it('rejects a sender who is not a member of the group', async () => {
    const { bob, response } = await scene();
    const mallory = await createUser();
    const bobOnline = await onlineRecipient(bob);

    const res = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(mallory))
      .send(relayBody({ responseId: response.id }));

    expect(res.status).toBe(403);
    expect(bobOnline.received).toHaveLength(0);
  });

  it('rejects a member relaying someone else’s response', async () => {
    const { alice, bob, response } = await scene();
    const aliceOnline = await onlineRecipient(alice);

    const res = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(bob))
      .send(relayBody({ responseId: response.id }));

    expect(res.status).toBe(403);
    expect(aliceOnline.received).toHaveLength(0);
  });

  it('rejects the author once they have left the group', async () => {
    const { alice, group, response } = await scene();
    await query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [group.id, alice.id]);

    const res = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ responseId: response.id }));

    expect(res.status).toBe(403);
  });

  it('answers 409 when the photo was encrypted under a stale key version', async () => {
    const { alice, group, response } = await scene();
    await query('UPDATE groups SET group_key_version = 2 WHERE id = $1', [group.id]);

    const stale = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ responseId: response.id }));
    expect(stale.status).toBe(409);
    const current = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ responseId: response.id, keyVersion: 2 }));
    expect(current.status).toBe(200);
  });

  it('answers 404 for an unknown response and 400 for a v1 body', async () => {
    const { alice } = await scene();

    const missing = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ responseId: crypto.randomUUID() }));
    expect(missing.status).toBe(404);
    const v1 = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send({ ...relayBody({ responseId: crypto.randomUUID() }), v: 1, recipient_user_ids: [alice.id] });
    expect(v1.status).toBe(400);
  });
});

describe('POST /api/photos/relay — who receives', () => {
  it('sends only to the sender’s audience: no strangers, no blocks, not the sender', async () => {
    const alice = await createUser();
    const [bob, carol, dave, stranger] = await Promise.all([createUser(), createUser(), createUser(), createUser()]);
    const group = await createGroup({ createdBy: alice, members: [bob, carol, dave] });
    const challenge = await createChallenge({ groupId: group.id, createdBy: alice });
    const response = await createResponse({ challengeId: challenge.id, user: alice });
    await block(alice, carol); // sender blocked a member
    await block(dave, alice); // a member blocked the sender
    const online = await Promise.all([alice, bob, carol, dave, stranger].map((u) => onlineRecipient(u)));

    const res = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ responseId: response.id }));

    expect(res.body).toEqual({ v: 2, delivered_user_ids: [bob.id], queued_user_ids: [] });
    expect(online.map((o) => o.received.length)).toEqual([0, 1, 0, 0, 0]);
  });

  it('queues offline members as one pickup each, however often the sender relays', async () => {
    const { alice, bob, response } = await scene();

    for (let i = 0; i < 2; i++) {
      const res = await server
        .api()
        .post('/api/photos/relay')
        .set(bearer(alice))
        .send(relayBody({ responseId: response.id }));
      expect(res.body).toEqual({ v: 2, delivered_user_ids: [], queued_user_ids: [bob.id] });
    }
    expect(await pickupsFor(bob.id)).toBe(1);
  });
});

describe('pickups', () => {
  it('when the recipient comes online, asks the sender’s device to re-relay, then drops the pickup', async () => {
    const { alice, bob, response } = await scene();
    const deviceId = crypto.randomUUID();
    await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ responseId: response.id, deviceId }));
    const sender = await senderDevice(alice, deviceId);

    const bobOnline = await onlineRecipient(bob);
    await until(() => sender.requests.length === 1);
    const [request] = sender.requests;
    expect(request).toMatchObject({ v: 2, response_id: response.id, recipient_user_id: bob.id });

    const fulfil = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ responseId: response.id, deviceId, pickupId: request.pickup_id }));

    expect(fulfil.body).toEqual({ v: 2, delivered_user_ids: [bob.id], queued_user_ids: [] });
    expect(bobOnline.received).toHaveLength(1);
    expect(await pickupsFor(bob.id)).toBe(0);
  });

  it('waits for the sender’s device, and re-offers a pickup whose lease lapsed', async () => {
    const { alice, bob, response } = await scene();
    const deviceId = crypto.randomUUID();
    await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ responseId: response.id, deviceId }));

    // Recipient online, sender's device offline: nothing to ask yet.
    await onlineRecipient(bob);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const lease = await query('SELECT lease_expires_at FROM pending_photo_pickups WHERE recipient_user_id = $1', [
      bob.id,
    ]);
    expect(lease.rows[0].lease_expires_at).toBeNull();

    // The sender's device connects → claimed with a lease and requested.
    const first = await senderDevice(alice, deviceId);
    await until(() => first.requests.length === 1);
    first.socket.disconnect(); // it never answers

    // While the lease holds, reconnecting doesn't re-ask…
    const second = await senderDevice(alice, deviceId);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(second.requests).toHaveLength(0);
    second.socket.disconnect();

    // …once it lapses, the next connect does.
    await query(`UPDATE pending_photo_pickups SET lease_expires_at = NOW() - INTERVAL '1 second'`);
    const third = await senderDevice(alice, deviceId);
    await until(() => third.requests.length === 1);
    expect(third.requests[0].pickup_id).toBe(first.requests[0].pickup_id);
  });

  it('only the pickup’s sender can fulfil it', async () => {
    const { alice, bob, group, challenge, response } = await scene();
    await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ responseId: response.id }));
    const pickup = await query<{ id: string }>('SELECT id FROM pending_photo_pickups');
    const carol = await createUser();
    await addMember(group.id, carol.id);
    const carolsPhoto = await createResponse({ challengeId: challenge.id, user: carol });

    const res = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(carol))
      .send(relayBody({ responseId: carolsPhoto.id, pickupId: pickup.rows[0].id }));

    expect(res.status).toBe(404);
    expect(await pickupsFor(bob.id)).toBe(1);
  });

  it('reaps pickups older than 7 days', async () => {
    const { alice, bob, response } = await scene();
    await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ responseId: response.id }));
    await query(`UPDATE pending_photo_pickups SET created_at = NOW() - INTERVAL '8 days'`);

    expect(await reapOldPickups()).toBe(1);
    expect(await pickupsFor(bob.id)).toBe(0);
  });
});

describe('server-managed group rooms', () => {
  it('puts sockets in their group rooms on connect, and keeps rooms in step with membership', async () => {
    const { alice, bob, group } = await scene();
    const carol = await createUser();
    await server.connectSocket(alice.token);
    await server.connectSocket(bob.token);
    await server.connectSocket(carol.token);
    await server.waitForRoomSize(`group:${group.id}`, 2);

    await server.api().post('/api/groups/join').set(bearer(carol)).send({ invite_code: group.invite_code });
    await server.waitForRoomSize(`group:${group.id}`, 3);

    await server.api().post(`/api/groups/${group.id}/leave`).set(bearer(bob));
    await until(async () => (await server.roomSize(`group:${group.id}`)) === 2);

    await server.api().delete(`/api/groups/${group.id}`).set(bearer(alice));
    await until(async () => (await server.roomSize(`group:${group.id}`)) === 0);
  });

  it('ignores the old client-side join-groups event', async () => {
    const { group } = await scene();
    const stranger = await createUser();
    const socket = await server.connectSocket(stranger.token);

    socket.emit('join-groups', [group.id]);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(await server.roomSize(`group:${group.id}`)).toBe(0);
  });
});
