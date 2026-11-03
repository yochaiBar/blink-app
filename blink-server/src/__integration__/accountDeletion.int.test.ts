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

  // KNOWN BUG (recovery plan Phase 2b): groups.created_by, challenges.triggered_by
  // and challenge_responses.user_id reference users(id) without ON DELETE, so
  // deleting an active user violates a foreign key and the route returns 500.
  it.failing('deletes a user who created a group and responded to a challenge', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const challenge = await createChallenge({ groupId: group.id, triggeredBy: alice });
    await createResponse({ challengeId: challenge.id, user: alice });

    const res = await server.api().delete('/api/auth/delete-account').set(bearer(alice));

    expect(res.status).toBe(200);
    expect(await countRows('SELECT COUNT(*) FROM users WHERE id = $1', [alice.id])).toBe(0);
  });
});
