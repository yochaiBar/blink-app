/**
 * Group routes beyond joining: detail, leave + admin hand-over, delete,
 * stats, list, private phone numbers and block-aware notifications.
 */
import { query } from '../config/database';
import { useTestServer } from './support/server';
import { pushRequests } from './support/httpStubs';
import {
  addMember,
  bearer,
  block,
  countRows,
  createChallenge,
  createGroup,
  createResponse,
  createUser,
  setPushToken,
  waitForPush,
} from './support/factories';

const server = useTestServer();

async function roleOf(groupId: string, userId: string): Promise<string | undefined> {
  const r = await query<{ role: string }>(`SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`, [
    groupId,
    userId,
  ]);
  return r.rows[0]?.role;
}

describe('groups', () => {
  it('GET /api/groups/:id returns members by display name, never phone number', async () => {
    const alice = await createUser({ display_name: 'Alice' });
    const nameless = await createUser();
    await query(`UPDATE users SET display_name = NULL WHERE id = $1`, [nameless.id]);
    const group = await createGroup({ createdBy: alice, members: [nameless] });

    const res = await server.api().get(`/api/groups/${group.id}`).set(bearer(alice));

    expect(res.status).toBe(200);
    expect(res.body.members.map((m: { display_name: string }) => m.display_name).sort()).toEqual([
      'Alice',
      'New member',
    ]);
    expect(JSON.stringify(res.body)).not.toContain(nameless.phone_number);
  });

  it('GET /api/groups/:id is 403 for non-members and 400 for a bad id', async () => {
    const alice = await createUser();
    const group = await createGroup({ createdBy: alice });
    const stranger = await createUser();

    expect((await server.api().get(`/api/groups/${group.id}`).set(bearer(stranger))).status).toBe(403);
    const bad = await server.api().get('/api/groups/not-a-uuid').set(bearer(stranger));
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'Invalid id format' });
  });

  it('GET /api/groups lists the caller’s groups with member counts', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    await createGroup({ createdBy: bob });

    const res = await server.api().get('/api/groups').set(bearer(alice));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: group.id, role: 'admin', member_count: 2, has_active_challenge: false });
  });

  it('a member leaving keeps the group; leaving twice is 404', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });

    expect((await server.api().post(`/api/groups/${group.id}/leave`).set(bearer(bob))).status).toBe(200);
    expect(await roleOf(group.id, bob.id)).toBeUndefined();
    expect((await server.api().post(`/api/groups/${group.id}/leave`).set(bearer(bob))).status).toBe(404);
  });

  it('the last admin leaving hands the group to the longest-standing member', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const carol = await createUser();
    const group = await createGroup({ createdBy: alice });
    await addMember(group.id, bob.id);
    await query(`UPDATE group_members SET joined_at = NOW() - INTERVAL '2 days' WHERE user_id = $1`, [bob.id]);
    await addMember(group.id, carol.id);

    const res = await server.api().post(`/api/groups/${group.id}/leave`).set(bearer(alice));

    expect(res.status).toBe(200);
    expect(await roleOf(group.id, bob.id)).toBe('admin');
    expect(await roleOf(group.id, carol.id)).toBe('member');
  });

  it('the last member leaving deletes the group', async () => {
    const alice = await createUser();
    const group = await createGroup({ createdBy: alice });

    const res = await server.api().post(`/api/groups/${group.id}/leave`).set(bearer(alice));

    expect(res.body.message).toMatch(/deleted/);
    expect(await countRows('SELECT COUNT(*) FROM groups WHERE id = $1', [group.id])).toBe(0);
  });

  it('only an admin can delete a group', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });

    expect((await server.api().delete(`/api/groups/${group.id}`).set(bearer(bob))).status).toBe(403);
    expect((await server.api().delete(`/api/groups/${group.id}`).set(bearer(alice))).status).toBe(200);
    expect(await countRows('SELECT COUNT(*) FROM groups WHERE id = $1', [group.id])).toBe(0);
  });

  it('GET /api/groups/:id/stats summarises the group', async () => {
    const alice = await createUser({ display_name: 'Alice' });
    const bob = await createUser({ display_name: 'Bob' });
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const challenge = await createChallenge({ groupId: group.id, createdBy: alice, status: 'completed' });
    await createResponse({ challengeId: challenge.id, user: bob });

    const res = await server.api().get(`/api/groups/${group.id}/stats`).set(bearer(alice));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      top_trigger: { user_id: alice.id, display_name: 'Alice', count: 1 },
      fastest_responder: { user_id: bob.id, display_name: 'Bob' },
      total_challenges: 1,
      completion_rate: 1,
    });
    const empty = await createGroup({ createdBy: alice });
    const none = await server.api().get(`/api/groups/${empty.id}/stats`).set(bearer(alice));
    expect(none.body).toMatchObject({ top_trigger: null, fastest_responder: null, total_challenges: 0 });
  });

  it('challenge pushes and join notifications skip members blocked with the actor', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const carol = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob, carol] });
    const bobToken = await setPushToken(bob);
    const carolToken = await setPushToken(carol);
    await block(carol, alice);

    const res = await server.api().post(`/api/challenges/groups/${group.id}/challenges`).set(bearer(alice)).send({});
    expect(res.status).toBe(201);
    const tokens = await waitForPush((t) => t.includes(bobToken), pushRequests);
    expect(tokens).not.toContain(carolToken);
    expect(
      await countRows(`SELECT COUNT(*) FROM notifications WHERE type = 'challenge_started' AND user_id = $1`, [
        carol.id,
      ]),
    ).toBe(0);

    const dave = await createUser();
    await block(dave, bob);
    expect(
      (await server.api().post('/api/groups/join').set(bearer(dave)).send({ invite_code: group.invite_code })).status,
    ).toBe(200);
    expect(
      await countRows(`SELECT COUNT(*) FROM notifications WHERE type = 'group_joined' AND user_id = $1`, [bob.id]),
    ).toBe(0);
    expect(
      await countRows(`SELECT COUNT(*) FROM notifications WHERE type = 'group_joined' AND user_id = $1`, [alice.id]),
    ).toBe(1);
  });

  it('joining a group you are already in is a no-op', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });

    const res = await server.api().post('/api/groups/join').set(bearer(bob)).send({ invite_code: group.invite_code });

    expect(res.status).toBe(200);
    expect(await countRows('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [group.id])).toBe(2);
    expect(await countRows(`SELECT COUNT(*) FROM notifications WHERE type = 'group_joined'`)).toBe(0);
  });

  it('pagination limits are validated', async () => {
    const alice = await createUser();
    const group = await createGroup({ createdBy: alice });
    const url = `/api/challenges/groups/${group.id}/challenges/history`;

    expect((await server.api().get(`${url}?limit=0`).set(bearer(alice))).status).toBe(400);
    expect((await server.api().get(`${url}?limit=51`).set(bearer(alice))).status).toBe(400);
    expect((await server.api().get(`${url}?limit=50`).set(bearer(alice))).status).toBe(200);
  });
});
