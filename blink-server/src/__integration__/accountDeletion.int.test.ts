/**
 * DELETE /api/auth/delete-account against real foreign keys.
 */
import { useTestServer } from './support/server';
import { bearer, countRows, createChallenge, createGroup, createResponse, createUser } from './support/factories';

const server = useTestServer();

describe('DELETE /api/auth/delete-account', () => {
  it('deletes a user with no groups or responses and revokes their token', async () => {
    const alice = await createUser();

    const res = await server.api().delete('/api/auth/delete-account').set(bearer(alice));

    expect(res.status).toBe(200);
    expect(await countRows('SELECT COUNT(*) FROM users WHERE id = $1', [alice.id])).toBe(0);
    const me = await server.api().get('/api/auth/me').set(bearer(alice));
    expect(me.status).toBe(401);
    expect(me.body).toEqual({ error: 'Token revoked' });
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
});
