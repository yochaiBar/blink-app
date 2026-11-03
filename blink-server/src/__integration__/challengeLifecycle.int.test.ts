/**
 * Challenge lifecycle against real Postgres: respond, complete, expire,
 * exactly-once finalize, one active challenge per group, reminders, the
 * daily scheduler and the read endpoints.
 */
import { query } from '../config/database';
import { expireDueChallenges, sendDueReminders } from '../services/challengeLifecycle';
import {
  AUTO_CHALLENGE_PROMPTS,
  DAY_END_HOUR,
  DAY_START_HOUR,
  nextAutoChallengeAt,
  runDailyChallengeTick,
} from '../jobs/dailyChallenge';
import { useTestServer } from './support/server';
import { raceBehindLock } from './support/db';
import { pushRequests } from './support/httpStubs';
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
  memberStats,
  setPushToken,
  waitForPush,
} from './support/factories';

const server = useTestServer();

async function statusOf(challengeId: string): Promise<string> {
  const r = await query<{ status: string }>('SELECT status FROM challenges WHERE id = $1', [challengeId]);
  return r.rows[0].status;
}

function localHour(instant: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(instant));
}

describe('responding', () => {
  it('measures the response time on the server and rejects duplicates', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const created = await server
      .api()
      .post(`/api/challenges/groups/${group.id}/challenges`)
      .set(bearer(alice))
      .send({});

    const res = await server
      .api()
      .post(`/api/challenges/${created.body.id}/respond`)
      .set(bearer(bob))
      .send({ has_photo: true, response_time_ms: 1 });

    expect(res.status).toBe(201);
    expect(res.body.has_photo).toBe(true);
    expect(res.body.response_time_ms).toBeGreaterThanOrEqual(0);
    expect(res.body.response_time_ms).toBeLessThan(60_000);
    const dup = await server.api().post(`/api/challenges/${created.body.id}/respond`).set(bearer(bob)).send({});
    expect(dup.status).toBe(400);
    expect(dup.body.error).toBe('Already responded');
  });

  it('rejects expired, missing and foreign challenges', async () => {
    const alice = await createUser();
    const stranger = await createUser();
    const group = await createGroup({ createdBy: alice });
    const expired = await createChallenge({ groupId: group.id, createdBy: alice, expiresInSeconds: -10 });

    expect((await server.api().post(`/api/challenges/${expired.id}/respond`).set(bearer(alice)).send({})).status).toBe(
      400,
    );
    expect(
      (await server.api().post(`/api/challenges/${expired.id}/respond`).set(bearer(stranger)).send({})).status,
    ).toBe(403);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await server.api().post(`/api/challenges/${missing}/respond`).set(bearer(alice)).send({})).status).toBe(
      404,
    );
    expect((await server.api().post('/api/challenges/nope/respond').set(bearer(alice)).send({})).status).toBe(400);
  });
});

describe('finalizing', () => {
  it('completes when the last eligible member responds, once, with one finalized event', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const created = await server
      .api()
      .post(`/api/challenges/groups/${group.id}/challenges`)
      .set(bearer(alice))
      .send({});
    // Joined after the challenge started: not eligible, doesn't hold it up.
    const late = await createUser();
    await addMember(group.id, late.id, 'member', 0);
    const socket = await server.connectSocket(alice.token);
    await server.waitForRoomSize(`group:${group.id}`, 1);
    const finalized = new Promise<{ status: string; groupStreak: number }>((resolve) =>
      socket.once('challenge:finalized', resolve),
    );

    await server.api().post(`/api/challenges/${created.body.id}/respond`).set(bearer(alice)).send({ has_photo: true });
    await server.api().post(`/api/challenges/${created.body.id}/respond`).set(bearer(bob)).send({ has_photo: true });

    expect(await finalized).toMatchObject({ status: 'completed', groupStreak: 1 });
    expect(await statusOf(created.body.id)).toBe('completed');
    const stats = await memberStats(group.id);
    expect(stats[alice.id]).toMatchObject({ total_challenges: 1, total_responses: 1, current_streak: 1 });
    expect(stats[bob.id]).toMatchObject({ total_challenges: 1, total_responses: 1, current_streak: 1 });
    expect(stats[late.id]).toMatchObject({ total_challenges: 0, current_streak: 0 });
  });

  it('the expiry job closes overdue challenges: responders extend streaks, others reset', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    await query('UPDATE group_members SET current_streak = 4 WHERE group_id = $1', [group.id]);
    await query('UPDATE groups SET group_streak = 3 WHERE id = $1', [group.id]);
    const challenge = await createChallenge({ groupId: group.id, createdBy: alice, expiresInSeconds: -60 });
    await createResponse({ challengeId: challenge.id, user: alice });

    expect(await expireDueChallenges()).toBe(1);

    expect(await statusOf(challenge.id)).toBe('expired');
    const stats = await memberStats(group.id);
    expect(stats[alice.id]).toMatchObject({ total_challenges: 1, total_responses: 1, current_streak: 5 });
    expect(stats[bob.id]).toMatchObject({ total_challenges: 1, total_responses: 0, current_streak: 0 });
    const g = await query('SELECT group_streak FROM groups WHERE id = $1', [group.id]);
    expect(g.rows[0].group_streak).toBe(0);
    expect(await expireDueChallenges()).toBe(0);
  });

  // Was KNOWN BUG (b) until Stage 2c: finalizing starts with an atomic claim,
  // so racing triggers settle the stats exactly once.
  it('counts a challenge exactly once when the expiry job and a new challenge race', async () => {
    const members = await Promise.all([createUser(), createUser(), createUser()]);
    const [alice, ...others] = members;
    const group = await createGroup({ createdBy: alice, members: others });
    const old = await createChallenge({ groupId: group.id, createdBy: alice, expiresInSeconds: -60 });

    const results = await raceBehindLock('challenges', 4, () =>
      Promise.all([
        expireDueChallenges(),
        expireDueChallenges(),
        expireDueChallenges(),
        server.api().post(`/api/challenges/groups/${group.id}/challenges`).set(bearer(alice)).send({}),
      ]),
    );

    expect((results[3] as { status: number }).status).toBe(201);
    expect(await statusOf(old.id)).toBe('expired');
    const stats = await memberStats(group.id);
    expect(members.map((m) => stats[m.id].total_challenges)).toEqual([1, 1, 1]);
    expect(
      await countRows(`SELECT COUNT(*) FROM challenges WHERE group_id = $1 AND status = 'active'`, [group.id]),
    ).toBe(1);
  });

  it('GETs never finalize anything', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const overdue = await createChallenge({ groupId: group.id, createdBy: alice, expiresInSeconds: -60 });

    const responses = await Promise.all(
      [alice, bob, alice, bob].map((u) =>
        server.api().get(`/api/challenges/groups/${group.id}/challenges/active`).set(bearer(u)),
      ),
    );

    expect(responses.map((r) => r.text)).toEqual(['null', 'null', 'null', 'null']);
    expect(await statusOf(overdue.id)).toBe('active');
    const stats = await memberStats(group.id);
    expect(stats[alice.id].total_challenges).toBe(0);
  });
});

describe('one active challenge per group', () => {
  it('starting a challenge replaces the active one, counting it once', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const first = await createChallenge({ groupId: group.id, createdBy: alice, expiresInSeconds: 200 });

    const second = await server.api().post(`/api/challenges/groups/${group.id}/challenges`).set(bearer(bob)).send({});

    expect(second.status).toBe(201);
    expect(await statusOf(first.id)).toBe('expired');
    expect((await memberStats(group.id))[bob.id].total_challenges).toBe(1);
  });

  it('concurrent starts produce exactly one challenge', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });

    const results = await Promise.all(
      [alice, bob, alice].map((u) =>
        server.api().post(`/api/challenges/groups/${group.id}/challenges`).set(bearer(u)).send({}),
      ),
    );

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await countRows('SELECT COUNT(*) FROM challenges WHERE group_id = $1', [group.id])).toBe(1);
  });

  it('the database refuses a second active challenge', async () => {
    const alice = await createUser();
    const group = await createGroup({ createdBy: alice });
    await createChallenge({ groupId: group.id, createdBy: alice });

    await expect(createChallenge({ groupId: group.id, createdBy: alice })).rejects.toThrow(
      /uniq_challenges_one_active_per_group/,
    );
  });
});

describe('pushes', () => {
  it('reminds eligible non-responders once, a minute before the end; respects push_enabled', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const carol = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob, carol] });
    const aliceToken = await setPushToken(alice);
    const bobToken = await setPushToken(bob);
    const carolToken = await setPushToken(carol);
    await query('UPDATE users SET push_enabled = FALSE WHERE id = $1', [carol.id]);
    const challenge = await createChallenge({ groupId: group.id, createdBy: alice, expiresInSeconds: 30 });
    await createResponse({ challengeId: challenge.id, user: alice });

    expect(await sendDueReminders()).toBe(1);
    const tokens = await waitForPush((t) => t.includes(bobToken), pushRequests);
    expect(tokens).not.toContain(aliceToken);
    expect(tokens).not.toContain(carolToken);
    expect(await sendDueReminders()).toBe(0);
  });

  it('does not remind about challenges that are far from ending', async () => {
    const alice = await createUser();
    const group = await createGroup({ createdBy: alice });
    await createChallenge({ groupId: group.id, createdBy: alice, expiresInSeconds: 200 });

    expect(await sendDueReminders()).toBe(0);
  });

  it('pushes the result to the group when a challenge finalizes', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const bobToken = await setPushToken(bob);
    await createChallenge({ groupId: group.id, createdBy: alice, expiresInSeconds: -5 });

    await expireDueChallenges();

    await waitForPush((t) => t.includes(bobToken), pushRequests);
    const finalize = pushRequests.find((r) => JSON.stringify(r.body).includes('challenge_finalized'));
    expect(finalize).toBeDefined();
  });
});

describe('daily scheduler', () => {
  it('schedules a daytime slot on the next local day', () => {
    const from = new Date('2026-11-03T22:30:00Z'); // 00:30 next day in Jerusalem
    for (const zone of ['UTC', 'Asia/Jerusalem', 'America/New_York']) {
      for (const r of [0, 0.5, 0.999]) {
        const at = nextAutoChallengeAt(zone, from, () => r);
        expect(at.getTime()).toBeGreaterThan(from.getTime());
        expect(localHour(at, zone)).toBeGreaterThanOrEqual(DAY_START_HOUR);
        expect(localHour(at, zone)).toBeLessThan(DAY_END_HOUR);
        expect(at.getTime() - from.getTime()).toBeLessThan(48 * 3600 * 1000);
      }
    }
  });

  it('new groups store their timezone and first slot; bad zones are rejected', async () => {
    const alice = await createUser();

    const res = await server
      .api()
      .post('/api/groups')
      .set(bearer(alice))
      .send({ name: 'Tel Aviv crew', timezone: 'Asia/Jerusalem' });
    expect(res.status).toBe(201);
    expect(res.body.timezone).toBe('Asia/Jerusalem');
    expect(new Date(res.body.next_auto_challenge_at).getTime()).toBeGreaterThan(Date.now());

    const bad = await server.api().post('/api/groups').set(bearer(alice)).send({ name: 'x', timezone: 'Mars/Base' });
    expect(bad.status).toBe(400);
  });

  it('starts one scheduler challenge per due group, even with racing ticks, and reschedules', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const lonely = await createGroup({ createdBy: bob });
    await query(`UPDATE groups SET next_auto_challenge_at = NOW() - INTERVAL '1 minute', timezone = 'Asia/Jerusalem'`);
    const socket = await server.connectSocket(alice.token);
    await server.waitForRoomSize(`group:${group.id}`, 1);
    const started = new Promise<{ group_id: string; created_by: string | null }>((resolve) =>
      socket.once('challenge:started', resolve),
    );

    const counts = await Promise.all([runDailyChallengeTick(), runDailyChallengeTick(), runDailyChallengeTick()]);

    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await started).toMatchObject({ group_id: group.id, created_by: null });
    const rows = await query<{ prompt: string; created_by: string | null; is_auto_generated: boolean }>(
      'SELECT prompt, created_by, is_auto_generated FROM challenges WHERE group_id = $1',
      [group.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ created_by: null, is_auto_generated: true });
    expect(AUTO_CHALLENGE_PROMPTS).toContain(rows.rows[0].prompt);
    expect(await countRows('SELECT COUNT(*) FROM challenges WHERE group_id = $1', [lonely.id])).toBe(0);
    const next = await query<{ next_auto_challenge_at: Date }>(
      'SELECT next_auto_challenge_at FROM groups WHERE id = ANY($1::uuid[])',
      [[group.id, lonely.id]],
    );
    for (const r of next.rows) expect(new Date(r.next_auto_challenge_at).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('read endpoints', () => {
  async function scene() {
    const alice = await createUser({ display_name: 'Alice' });
    const bob = await createUser({ display_name: 'Bob' });
    const carol = await createUser({ display_name: 'Carol' });
    const group = await createGroup({ createdBy: alice, members: [bob, carol] });
    const challenge = await createChallenge({ groupId: group.id, createdBy: alice });
    const bobPhoto = await createResponse({ challengeId: challenge.id, user: bob });
    await createResponse({ challengeId: challenge.id, user: carol });
    await createReaction({ responseId: bobPhoto.id, user: carol, emoji: '🔥' });
    await createComment({ responseId: bobPhoto.id, user: carol });
    return { alice, bob, carol, group, challenge, bobPhoto };
  }

  it('GET /api/challenges/:id shows every visible response to members, no reveal gate', async () => {
    const { alice, bob, carol, challenge, bobPhoto } = await scene();
    await block(alice, carol);

    const res = await server.api().get(`/api/challenges/${challenge.id}`).set(bearer(alice));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: challenge.id, user_has_responded: false, member_count: 3, response_count: 1 });
    expect(res.body.responses).toEqual([
      expect.objectContaining({ id: bobPhoto.id, user_id: bob.id, display_name: 'Bob', has_photo: true }),
    ]);
    // Carol's reaction and comment are hidden from Alice, who blocked her.
    expect(res.body.responses[0]).toMatchObject({ reactions: [], comment_count: 0 });
    const asBob = await server.api().get(`/api/challenges/${challenge.id}`).set(bearer(bob));
    expect(asBob.body.responses.find((r: { id: string }) => r.id === bobPhoto.id)).toMatchObject({
      reactions: [{ emoji: '🔥', count: 1 }],
      comment_count: 1,
    });
  });

  it('GET /api/challenges/:id is 403 for non-members and 404 when missing', async () => {
    const { challenge } = await scene();
    const stranger = await createUser();

    expect((await server.api().get(`/api/challenges/${challenge.id}`).set(bearer(stranger))).status).toBe(403);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await server.api().get(`/api/challenges/${missing}`).set(bearer(stranger))).status).toBe(404);
  });

  it('the old /responses and /reveal routes no longer require having played', async () => {
    const { alice, challenge } = await scene();

    expect((await server.api().get(`/api/challenges/${challenge.id}/responses`).set(bearer(alice))).status).toBe(200);
    expect((await server.api().get(`/api/challenges/${challenge.id}/reveal`).set(bearer(alice))).status).toBe(200);
  });

  it('GET /api/groups/:id/challenges pages newest first with a before cursor', async () => {
    const alice = await createUser();
    const group = await createGroup({ createdBy: alice });
    const oldest = await createChallenge({
      groupId: group.id,
      createdBy: alice,
      expiresInSeconds: -3000,
      status: 'expired',
    });
    const middle = await createChallenge({
      groupId: group.id,
      createdBy: alice,
      expiresInSeconds: -2000,
      status: 'expired',
    });
    const newest = await createChallenge({
      groupId: group.id,
      createdBy: alice,
      expiresInSeconds: -1000,
      status: 'expired',
    });
    const url = `/api/groups/${group.id}/challenges`;

    const page1 = await server.api().get(`${url}?limit=2`).set(bearer(alice));
    expect(page1.body.map((c: { id: string }) => c.id)).toEqual([newest.id, middle.id]);
    const before = new Date(page1.body[1].created_at).toISOString();
    const page2 = await server
      .api()
      .get(`${url}?limit=2&before=${encodeURIComponent(before)}`)
      .set(bearer(alice));
    expect(page2.body.map((c: { id: string }) => c.id)).toEqual([oldest.id]);
    expect(
      (
        await server
          .api()
          .get(url)
          .set(bearer(await createUser()))
      ).status,
    ).toBe(403);
  });

  it('GET /api/feed spans the caller’s groups only, with responses, paged', async () => {
    const { alice, group, challenge } = await scene();
    const other = await createGroup({ createdBy: alice });
    const otherChallenge = await createChallenge({
      groupId: other.id,
      createdBy: alice,
      expiresInSeconds: -100,
      status: 'expired',
    });
    const foreign = await createGroup({ createdBy: await createUser() });
    await createChallenge({ groupId: foreign.id, createdBy: null });

    const page1 = await server.api().get('/api/feed?limit=1').set(bearer(alice));
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((c: { id: string }) => c.id)).toEqual([challenge.id]);
    expect(page1.body.items[0]).toMatchObject({ group_id: group.id, group_name: 'Test Group' });
    expect(page1.body.items[0].responses).toHaveLength(2);
    expect(page1.body.next_before).toEqual(expect.any(String));

    const page2 = await server
      .api()
      .get(`/api/feed?limit=1&before=${encodeURIComponent(page1.body.next_before)}`)
      .set(bearer(alice));
    expect(page2.body.items.map((c: { id: string }) => c.id)).toEqual([otherChallenge.id]);
  });
});
