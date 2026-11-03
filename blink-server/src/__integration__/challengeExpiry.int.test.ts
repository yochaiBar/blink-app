/**
 * Lazy expiry in GET /api/challenges/groups/:groupId/challenges/active:
 * an expired-but-still-'active' challenge is finalized (skips + stats) by
 * whichever request sees it first.
 */
import { query } from '../config/database';
import { useTestServer } from './support/server';
import { bearer, createChallenge, createGroup, createResponse, createUser } from './support/factories';
import { raceBehindLock } from './support/db';

const server = useTestServer();

async function totalChallengesByUser(groupId: string): Promise<Record<string, number>> {
  const result = await query<{ user_id: string; total_challenges: number }>(
    'SELECT user_id, total_challenges FROM group_members WHERE group_id = $1',
    [groupId],
  );
  return Object.fromEntries(result.rows.map((r) => [r.user_id, r.total_challenges]));
}

describe('GET /api/challenges/groups/:groupId/challenges/active — expiry', () => {
  it('counts an expired challenge once and resets the streak of non-responders', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    await query('UPDATE group_members SET current_streak = 4 WHERE group_id = $1', [group.id]);
    const challenge = await createChallenge({ groupId: group.id, createdBy: alice, expiresInSeconds: -60 });
    await createResponse({ challengeId: challenge.id, user: alice });

    const res = await server.api().get(`/api/challenges/groups/${group.id}/challenges/active`).set(bearer(alice));

    expect(res.status).toBe(200);
    expect(await totalChallengesByUser(group.id)).toEqual({ [alice.id]: 1, [bob.id]: 1 });
    const streaks = await query<{ user_id: string; current_streak: number }>(
      'SELECT user_id, current_streak FROM group_members WHERE group_id = $1',
      [group.id],
    );
    expect(Object.fromEntries(streaks.rows.map((r) => [r.user_id, r.current_streak]))).toEqual({
      [alice.id]: 5,
      [bob.id]: 0,
    });
    const row = await query('SELECT status FROM challenges WHERE id = $1', [challenge.id]);
    expect(row.rows[0].status).toBe('expired');
  });

  // KNOWN BUG (recovery plan Phase 2c): every concurrent request that reads the
  // expired row before one of them flips it to 'expired' runs
  // processSkipsForChallenge, so total_challenges is incremented once per
  // request. Fix: atomic claim (UPDATE ... WHERE status = 'active' RETURNING).
  it.failing('increments total_challenges exactly once under concurrent requests', async () => {
    const members = await Promise.all([createUser(), createUser(), createUser(), createUser()]);
    const [alice, ...others] = members;
    const group = await createGroup({ createdBy: alice, members: others });
    await createChallenge({ groupId: group.id, createdBy: alice, expiresInSeconds: -60 });

    // Every request reads the expired row, then queues on its first write to
    // challenges (today: the UPDATE ... SET status = 'expired' after settling
    // stats), so none can finalize first.
    const requesters = [...members, ...members];
    const responses = await raceBehindLock('challenges', requesters.length, () =>
      Promise.all(
        requesters.map((m) => server.api().get(`/api/challenges/groups/${group.id}/challenges/active`).set(bearer(m))),
      ),
    );

    expect(responses.map((r) => r.status)).toEqual(responses.map(() => 200));
    const totals = await totalChallengesByUser(group.id);
    expect(Object.values(totals)).toEqual(members.map(() => 1));
  });
});
