/**
 * POST /api/photos/relay with real Socket.io recipients.
 */
import type { Socket as ClientSocket } from 'socket.io-client';
import crypto from 'crypto';
import { useTestServer } from './support/server';
import {
  TestUser,
  bearer,
  block,
  countRows,
  createChallenge,
  createGroup,
  createResponse,
  createUser,
} from './support/factories';

const server = useTestServer();

interface IncomingPhoto {
  group_id: string;
  sender_user_id: string;
  ciphertext_b64: string;
}

/** Connect `user` as an online recipient that ACKs every photo:incoming. */
async function onlineRecipient(user: TestUser): Promise<{ socket: ClientSocket; received: IncomingPhoto[] }> {
  const socket = await server.connectSocket(user.token);
  const received: IncomingPhoto[] = [];
  socket.on('photo:incoming', (payload: IncomingPhoto, ack: (r: { ok: boolean }) => void) => {
    received.push(payload);
    ack({ ok: true });
  });
  return { socket, received };
}

function relayBody(opts: { groupId: string; challengeId: string; responseId: string; recipients: string[] }) {
  return {
    v: 1,
    group_id: opts.groupId,
    challenge_id: opts.challengeId,
    response_id: opts.responseId,
    sender_device_id: crypto.randomUUID(),
    iv_b64: 'AAAAAAAAAAAAAAAA',
    auth_tag_b64: 'AAAAAAAAAAAAAAAAAAAAAA==',
    ciphertext_b64: 'c2VjcmV0IHBob3Rv',
    recipient_user_ids: opts.recipients,
  };
}

describe('POST /api/photos/relay', () => {
  it('delivers a member’s photo to an online member over Socket.io', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const challenge = await createChallenge({ groupId: group.id, createdBy: alice });
    const response = await createResponse({ challengeId: challenge.id, user: alice });
    const bobOnline = await onlineRecipient(bob);

    const res = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ groupId: group.id, challengeId: challenge.id, responseId: response.id, recipients: [bob.id] }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ v: 1, delivered_user_ids: [bob.id], queued_user_ids: [] });
    expect(bobOnline.received).toHaveLength(1);
    expect(bobOnline.received[0]).toMatchObject({ group_id: group.id, sender_user_id: alice.id });
  });

  it('queues a pending pickup for an offline member', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const challenge = await createChallenge({ groupId: group.id, createdBy: alice });
    const response = await createResponse({ challengeId: challenge.id, user: alice });

    const res = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(relayBody({ groupId: group.id, challengeId: challenge.id, responseId: response.id, recipients: [bob.id] }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ v: 1, delivered_user_ids: [], queued_user_ids: [bob.id] });
    expect(
      await countRows(`SELECT COUNT(*) FROM pending_photo_pickups WHERE recipient_user_id = $1 AND state = 'pending'`, [
        bob.id,
      ]),
    ).toBe(1);
  });

  it('delivers only to members of the sender’s audience: no strangers, no blocks, not the sender', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const carol = await createUser();
    const dave = await createUser();
    const stranger = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob, carol, dave] });
    const challenge = await createChallenge({ groupId: group.id, createdBy: alice });
    const response = await createResponse({ challengeId: challenge.id, user: alice });
    await block(alice, carol); // sender blocked a recipient
    await block(dave, alice); // a recipient blocked the sender
    const online = await Promise.all([bob, carol, dave, stranger].map((u) => onlineRecipient(u)));

    const res = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(alice))
      .send(
        relayBody({
          groupId: group.id,
          challengeId: challenge.id,
          responseId: response.id,
          recipients: [alice.id, bob.id, carol.id, dave.id, stranger.id],
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ v: 1, delivered_user_ids: [bob.id], queued_user_ids: [] });
    expect(online.map((o) => o.received.length)).toEqual([1, 0, 0, 0]);
  });

  // KNOWN BUG (recovery plan Phase 3): the relay only filters *recipients* by
  // membership; it never checks that the *sender* belongs to the group (or
  // owns the response), so any authenticated user can push bytes to members.
  it.failing('rejects a sender who is not a member of the group', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const mallory = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const challenge = await createChallenge({ groupId: group.id, createdBy: alice });
    const response = await createResponse({ challengeId: challenge.id, user: alice });
    const bobOnline = await onlineRecipient(bob);

    const res = await server
      .api()
      .post('/api/photos/relay')
      .set(bearer(mallory))
      .send(relayBody({ groupId: group.id, challengeId: challenge.id, responseId: response.id, recipients: [bob.id] }));

    expect(res.status).toBe(403);
    expect(bobOnline.received).toHaveLength(0);
  });
});
