/**
 * DELETE /api/auth/delete-account against real foreign keys.
 */
import { useTestServer } from './support/server';
import { query } from '../config/database';
import {
  addMember,
  bearer,
  block,
  countRows,
  createChallenge,
  createComment,
  createGroup,
  createReaction,
  createResponse,
  createUser,
} from './support/factories';

const server = useTestServer();

describe('DELETE /api/auth/delete-account', () => {
  it('deletes a user with no groups or responses and revokes their token', async () => {
    const alice = await createUser();

    const res = await server.api().delete('/api/auth/delete-account').set(bearer(alice));

    expect(res.status).toBe(200);
    expect(await countRows('SELECT COUNT(*) FROM users WHERE id = $1', [alice.id])).toBe(0);
    const me = await server.api().get('/api/auth/me').set(bearer(alice));
    expect(me.status).toBe(401);
    expect(me.body).toEqual({ error: 'Invalid token' });
  });

  // Was KNOWN BUG (a) until 001_baseline set ON DELETE on every FK to users.
  it('deletes a user who created a group and responded to a challenge', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const challenge = await createChallenge({ groupId: group.id, createdBy: alice });
    await createResponse({ challengeId: challenge.id, user: alice });

    const res = await server.api().delete('/api/auth/delete-account').set(bearer(alice));

    expect(res.status).toBe(200);
    expect(await countRows('SELECT COUNT(*) FROM users WHERE id = $1', [alice.id])).toBe(0);
    // Shared rows survive with the reference cleared; personal rows go.
    expect(await countRows('SELECT COUNT(*) FROM groups WHERE id = $1 AND created_by IS NULL', [group.id])).toBe(1);
    expect(
      await countRows('SELECT COUNT(*) FROM challenges WHERE id = $1 AND created_by IS NULL', [challenge.id]),
    ).toBe(1);
    expect(await countRows('SELECT COUNT(*) FROM challenge_responses WHERE user_id = $1', [alice.id])).toBe(0);
    expect(await countRows('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [group.id])).toBe(1);
  });

  it('deletes a user with a full footprint: hands over groups, drops personal rows, disconnects sockets', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const carol = await createUser();
    const shared = await createGroup({ createdBy: alice, members: [bob] }); // alice is the only admin
    const solo = await createGroup({ createdBy: alice }); // alice is the only member
    const bobs = await createGroup({ createdBy: bob });
    await addMember(bobs.id, alice.id);
    const challenge = await createChallenge({ groupId: shared.id, createdBy: alice });
    const alicePhoto = await createResponse({ challengeId: challenge.id, user: alice });
    const bobPhoto = await createResponse({ challengeId: challenge.id, user: bob });
    await createReaction({ responseId: bobPhoto.id, user: alice });
    await createReaction({ responseId: alicePhoto.id, user: bob });
    await createComment({ responseId: bobPhoto.id, user: alice });
    await createComment({ responseId: alicePhoto.id, user: bob });
    await block(alice, carol);
    await block(carol, alice);
    await query(`INSERT INTO notifications (user_id, type, title, body, from_user_id) VALUES ($1, 'x', 't', 'b', $2)`, [
      bob.id,
      alice.id,
    ]);
    const socket = await server.connectSocket(alice.token);
    const disconnected = new Promise<string>((resolve) => socket.once('disconnect', resolve));

    const res = await server.api().delete('/api/auth/delete-account').set(bearer(alice));

    expect(res.status).toBe(200);
    expect(await disconnected).toBe('io server disconnect');
    // Groups: handed over, deleted when empty, untouched when someone else administers.
    const sharedAdmin = await query(`SELECT user_id FROM group_members WHERE group_id = $1 AND role = 'admin'`, [
      shared.id,
    ]);
    expect(sharedAdmin.rows).toEqual([{ user_id: bob.id }]);
    expect(await countRows('SELECT COUNT(*) FROM groups WHERE id = $1', [solo.id])).toBe(0);
    expect(await countRows('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [bobs.id])).toBe(1);
    // Personal rows are gone; other people's content survives.
    for (const table of ['auth_sessions', 'challenge_responses', 'reactions', 'response_comments', 'group_members']) {
      expect(await countRows(`SELECT COUNT(*) FROM ${table} WHERE user_id = $1`, [alice.id])).toBe(0);
    }
    expect(
      await countRows('SELECT COUNT(*) FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1', [alice.id]),
    ).toBe(0);
    expect(await countRows('SELECT COUNT(*) FROM challenge_responses WHERE id = $1', [bobPhoto.id])).toBe(1);
    expect(await countRows('SELECT COUNT(*) FROM reactions WHERE user_id = $1', [bob.id])).toBe(0); // was on alice's photo
    const note = await query('SELECT from_user_id FROM notifications WHERE user_id = $1', [bob.id]);
    expect(note.rows).toEqual([{ from_user_id: null }]);
    expect((await server.api().get('/api/auth/me').set(bearer(alice))).status).toBe(401);
  });
});
