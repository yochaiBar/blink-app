/**
 * POST /api/groups/join and the max_members cap.
 */
import { useTestServer } from './support/server';
import { bearer, countRows, createGroup, createUser } from './support/factories';
import { raceBehindLock } from './support/db';

const server = useTestServer();

const memberCount = (groupId: string) => countRows('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [groupId]);

describe('POST /api/groups/join — capacity', () => {
  it('rejects a join once the group is full', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const carol = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob], maxMembers: 2 });

    const res = await server.api().post('/api/groups/join').set(bearer(carol)).send({ invite_code: group.invite_code });

    expect(res.status).toBe(404);
    expect(await memberCount(group.id)).toBe(2);
  });

  it('accepts lowercase invite codes', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice });

    const res = await server
      .api()
      .post('/api/groups/join')
      .set(bearer(bob))
      .send({ invite_code: group.invite_code.toLowerCase() });

    expect(res.status).toBe(200);
    expect(await memberCount(group.id)).toBe(2);
  });

  // Was KNOWN BUG (d) until Stage 2b locked the group row around the
  // capacity check + insert.
  it('never exceeds max_members under concurrent joins', async () => {
    const alice = await createUser();
    const group = await createGroup({ createdBy: alice, maxMembers: 3 });
    const joiners = await Promise.all(Array.from({ length: 6 }, () => createUser()));

    // Every joiner reads the member count, then queues on the INSERT.
    await raceBehindLock('group_members', joiners.length, () =>
      Promise.all(
        joiners.map((j) =>
          server.api().post('/api/groups/join').set(bearer(j)).send({ invite_code: group.invite_code }),
        ),
      ),
    );

    expect(await memberCount(group.id)).toBeLessThanOrEqual(3);
  });
});
