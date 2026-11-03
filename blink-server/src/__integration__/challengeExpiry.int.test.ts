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
  it('counts an expired challenge once and records skips for non-responders', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const challenge = await createChallenge({ groupId: group.id, triggeredBy: alice, expiresInSeconds: -60 });
    await createResponse({ challengeId: challenge.id, user: alice });

    const res = await server.api().get(`/api/challenges/groups/${group.id}/challenges/active`).set(bearer(alice));

    expect(res.status).toBe(200);
    expect(await totalChallengesByUser(group.id)).toEqual({ [alice.id]: 1, [bob.id]: 1 });
    const skips = await query(
      `SELECT user_id FROM challenge_responses WHERE challenge_id = $1 AND response_type = 'skip'`,
      [challenge.id],
    );
    expect(skips.rows).toEqual([{ user_id: bob.id }]);
  });

  // KNOWN BUG (recovery plan Phase 2c): every concurrent request that reads the
  // expired row before one of them flips it to 'expired' runs
  // processSkipsForChallenge, so total_challenges is incremented once per
  // request. Fix: atomic claim (UPDATE ... WHERE status = 'active' RETURNING).
  it.failing('increments total_challenges exactly once under concurrent requests', async () => {
    const members = await Promise.all([createUser(), createUser(), createUser(), createUser()]);
    const [alice, ...others] = members;
    const group = await createGroup({ createdBy: alice, members: others });
    await createChallenge({ groupId: group.id, triggeredBy: alice, expiresInSeconds: -60 });

    // Every request reads the expired row, then queues on its first write to
    // challenges (today: the skip INSERT's FK check), so none can finalize first.
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
