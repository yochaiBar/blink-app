/**
 * Challenge lifecycle: create → respond → finalize. The only code that
 * changes challenge status or member streak stats.
 *
 * Finalizing is exactly-once: it starts with an atomic claim
 * (UPDATE ... WHERE status = 'active' RETURNING), so whichever trigger gets
 * there first settles the stats and every other one is a no-op. Triggers:
 *   - the last eligible member responds        → 'completed'
 *   - the expiry job finds it past expires_at  → 'expired'
 *   - a new challenge replaces it              → 'expired'
 * "Eligible" = joined the group before the challenge started. Reads never
 * finalize anything.
 */
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../config/database';
import { emitToGroup, emitToUsers } from '../socket';
import { sendPushToUsers } from './pushNotifications';
import { audienceOf } from './audience';
import { requireMember } from './membership';
import { createNotification } from '../utils/notifications';
import { HttpError } from '../utils/httpError';
import logger from '../utils/logger';
import type { ChallengeResponseRow } from '../types/db';

export const CHALLENGE_DURATION_SECONDS = 5 * 60;
export const MILESTONES = [3, 7, 14, 30, 50, 100];
const CREATE_COOLDOWN = "INTERVAL '5 seconds'";

// Columns every challenge payload returns to the client.
export const CHALLENGE_SELECT = `id, group_id, prompt, created_by, created_at, expires_at, status`;

export interface ChallengePayload {
  id: string;
  group_id: string;
  prompt: string | null;
  created_by: string | null;
  created_at: Date;
  expires_at: Date;
  status: string;
}

export interface ChallengeFinalized {
  challengeId: string;
  groupId: string;
  status: 'completed' | 'expired';
  groupStreak: number;
  /** A non-responder who broke a running group streak, if one did. */
  brokenBy: string | null;
  milestones: { userId: string; displayName: string; streak: number }[];
}

function logFailure(message: string, meta: Record<string, unknown>) {
  return (err: unknown) => logger.error(message, { ...meta, error: err instanceof Error ? err.message : String(err) });
}

// ── Finalize ─────────────────────────────────────────────────────

/** Claim and settle a challenge on the caller's transaction; null if already final. */
async function finalizeOn(
  client: PoolClient,
  challengeId: string,
  status: 'completed' | 'expired',
): Promise<ChallengeFinalized | null> {
  const claimed = await client.query<{ group_id: string; created_at: Date }>(
    `UPDATE challenges SET status = $2 WHERE id = $1 AND status = 'active' RETURNING group_id, created_at`,
    [challengeId, status],
  );
  if (claimed.rows.length === 0) return null;
  const { group_id: groupId, created_at: createdAt } = claimed.rows[0];

  // One UPDATE settles every eligible member.
  const settled = await client.query<{ user_id: string; current_streak: number; responded: boolean }>(
    `UPDATE group_members gm
        SET total_challenges = gm.total_challenges + 1,
            total_responses = gm.total_responses + CASE WHEN e.responded THEN 1 ELSE 0 END,
            current_streak = CASE WHEN e.responded THEN gm.current_streak + 1 ELSE 0 END
       FROM (SELECT m.id,
                    EXISTS (SELECT 1 FROM challenge_responses cr
                             WHERE cr.challenge_id = $1 AND cr.user_id = m.user_id) AS responded
               FROM group_members m
              WHERE m.group_id = $2 AND m.joined_at <= $3) e
      WHERE gm.id = e.id
      RETURNING gm.user_id, gm.current_streak, e.responded`,
    [challengeId, groupId, createdAt],
  );

  const everyone = settled.rows.length > 0 && settled.rows.every((r) => r.responded);
  const streak = await client.query<{ group_streak: number; previous: number }>(
    `WITH prev AS (SELECT group_streak FROM groups WHERE id = $1)
     UPDATE groups
        SET group_streak = CASE WHEN $2 THEN group_streak + 1 ELSE 0 END,
            longest_group_streak = CASE WHEN $2 THEN GREATEST(longest_group_streak, group_streak + 1)
                                        ELSE longest_group_streak END
      WHERE id = $1
      RETURNING group_streak, (SELECT group_streak FROM prev) AS previous`,
    [groupId, everyone],
  );
  const { group_streak: groupStreak, previous } = streak.rows[0];

  const milestoneRows = settled.rows.filter((r) => r.responded && MILESTONES.includes(r.current_streak));
  const names = milestoneRows.length
    ? await client.query<{ id: string; display_name: string }>(
        `SELECT id, display_name FROM public_users WHERE id = ANY($1::uuid[])`,
        [milestoneRows.map((r) => r.user_id)],
      )
    : { rows: [] };
  const nameOf = new Map(names.rows.map((n) => [n.id, n.display_name]));

  return {
    challengeId,
    groupId,
    status,
    groupStreak,
    brokenBy: !everyone && previous > 0 ? (settled.rows.find((r) => !r.responded)?.user_id ?? null) : null,
    milestones: milestoneRows.map((r) => ({
      userId: r.user_id,
      displayName: nameOf.get(r.user_id) ?? 'New member',
      streak: r.current_streak,
    })),
  };
}

/** Tell the group, after the finalizing transaction committed. */
function announceFinalized(event: ChallengeFinalized): void {
  emitToGroup(event.groupId, 'challenge:finalized', event);

  // TODO(Stage 4): the app still listens to these; drop them once it uses
  // challenge:finalized (services/socketEvents.ts).
  if (event.status === 'completed') {
    emitToGroup(event.groupId, 'challenge:completed', { challengeId: event.challengeId, groupId: event.groupId });
  }
  emitToGroup(event.groupId, 'group:streak_update', {
    groupId: event.groupId,
    groupStreak: event.groupStreak,
    brokenBy: event.brokenBy,
  });
  for (const m of event.milestones) {
    emitToGroup(event.groupId, 'streak:milestone', {
      userId: m.userId,
      displayName: m.displayName,
      milestone: m.streak,
      groupId: event.groupId,
    });
  }

  query<{ user_id: string }>(`SELECT user_id FROM group_members WHERE group_id = $1`, [event.groupId])
    .then(({ rows }) =>
      sendPushToUsers(
        rows.map((r) => r.user_id),
        event.status === 'completed' ? 'Challenge complete!' : 'Challenge closed',
        event.status === 'completed' ? 'Everyone responded — see the results' : 'See who made it in time',
        { type: 'challenge_finalized', challengeId: event.challengeId, groupId: event.groupId, status: event.status },
      ),
    )
    .catch(logFailure('Finalize push failed', { challengeId: event.challengeId }));
}

/** Finalize one challenge in its own transaction; null if it was already final. */
export async function finalizeChallenge(
  challengeId: string,
  status: 'completed' | 'expired',
): Promise<ChallengeFinalized | null> {
  const event = await withTransaction((client) => finalizeOn(client, challengeId, status));
  if (event) announceFinalized(event);
  return event;
}

// ── Create ───────────────────────────────────────────────────────

/**
 * Start a challenge (manual: `createdBy` = the member; scheduler: null).
 * Finalizes the group's current challenge, if any, in the same transaction;
 * the partial unique index keeps it at one active challenge per group.
 */
export async function createChallenge(opts: {
  groupId: string;
  createdBy: string | null;
  prompt?: string | null;
}): Promise<ChallengePayload> {
  const { challenge, replaced } = await withTransaction(async (client) => {
    // Serialize creation per group (FOR UPDATE can't lock rows that don't exist yet).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [opts.groupId]);

    const recent = await client.query(
      `SELECT 1 FROM challenges WHERE group_id = $1 AND created_at > NOW() - ${CREATE_COOLDOWN} LIMIT 1`,
      [opts.groupId],
    );
    if (recent.rows.length > 0) throw new HttpError(409, 'A challenge was just started');

    const active = await client.query<{ id: string }>(
      `SELECT id FROM challenges WHERE group_id = $1 AND status = 'active'`,
      [opts.groupId],
    );
    const replaced: ChallengeFinalized[] = [];
    for (const { id } of active.rows) {
      const event = await finalizeOn(client, id, 'expired');
      if (event) replaced.push(event);
    }

    const inserted = await client.query<ChallengePayload>(
      `INSERT INTO challenges (group_id, created_by, prompt, expires_at, is_auto_generated)
       VALUES ($1, $2, $3, NOW() + make_interval(secs => $4), $5)
       RETURNING ${CHALLENGE_SELECT}`,
      [opts.groupId, opts.createdBy, opts.prompt ?? null, CHALLENGE_DURATION_SECONDS, opts.createdBy === null],
    );
    return { challenge: inserted.rows[0], replaced };
  });

  replaced.forEach(announceFinalized);
  emitToGroup(opts.groupId, 'challenge:started', challenge);
  notifyChallengeStarted(challenge).catch(logFailure('Challenge start notification failed', { id: challenge.id }));
  logger.info('Challenge started', { groupId: opts.groupId, challengeId: challenge.id, auto: !opts.createdBy });
  return challenge;
}

/** In-app notification + push to the creator's audience (or everyone, for the scheduler). */
async function notifyChallengeStarted(challenge: ChallengePayload): Promise<void> {
  const group = await query<{ name: string }>(`SELECT name FROM groups WHERE id = $1`, [challenge.group_id]);
  const groupName = group.rows[0]?.name || 'your group';

  let recipients: string[];
  let body: string;
  if (challenge.created_by) {
    recipients = await audienceOf(challenge.group_id, challenge.created_by);
    const creator = await query<{ display_name: string }>(`SELECT display_name FROM public_users WHERE id = $1`, [
      challenge.created_by,
    ]);
    body = `${creator.rows[0]?.display_name || 'Someone'} started a snap challenge in ${groupName}`;
  } else {
    const members = await query<{ user_id: string }>(`SELECT user_id FROM group_members WHERE group_id = $1`, [
      challenge.group_id,
    ]);
    recipients = members.rows.map((m) => m.user_id);
    body = challenge.prompt ? `${groupName}: ${challenge.prompt}` : `New challenge in ${groupName}`;
  }

  for (const userId of recipients) {
    await createNotification(
      userId,
      'challenge_started',
      'New Challenge!',
      body,
      challenge.group_id,
      challenge.created_by ?? undefined,
    );
  }
  await sendPushToUsers(recipients, 'New Challenge!', body, {
    type: 'challenge_started',
    challengeId: challenge.id,
    groupId: challenge.group_id,
    challengeType: 'snap',
    screen: 'challenge',
  });
}

// ── Respond ──────────────────────────────────────────────────────

/**
 * Record a member's response. The response time is measured by the server
 * (from challenge start). Completes the challenge if this was the last
 * eligible member.
 */
export async function respondToChallenge(
  challengeId: string,
  userId: string,
  hasPhoto: boolean,
): Promise<{ response: ChallengeResponseRow; groupId: string }> {
  const membership = await requireMember(userId, { challengeId });

  const inserted = await query<ChallengeResponseRow>(
    `INSERT INTO challenge_responses (challenge_id, user_id, has_photo, response_time_ms)
     SELECT c.id, $2, $3, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - c.created_at)) * 1000))::int
       FROM challenges c
      WHERE c.id = $1 AND c.status = 'active' AND c.expires_at > NOW()
     ON CONFLICT (challenge_id, user_id) DO NOTHING
     RETURNING *`,
    [challengeId, userId, hasPhoto],
  );
  if (inserted.rows.length === 0) {
    const existing = await query(`SELECT 1 FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`, [
      challengeId,
      userId,
    ]);
    if (existing.rows.length > 0) throw new HttpError(400, 'Already responded');
    throw new HttpError(400, 'This challenge has expired or is no longer active');
  }
  const response = inserted.rows[0];

  emitToUsers([userId, ...(await audienceOf(membership.groupId, userId))], 'challenge:response', {
    challengeId,
    groupId: membership.groupId,
    response,
  });

  await completeIfEveryoneResponded(challengeId).catch(logFailure('Completion check failed', { challengeId }));
  return { response, groupId: membership.groupId };
}

/** Finalize as 'completed' once every eligible member has responded. */
export async function completeIfEveryoneResponded(challengeId: string): Promise<ChallengeFinalized | null> {
  const state = await query<{ status: string; waiting: number }>(
    `SELECT c.status,
            (SELECT COUNT(*)::int FROM group_members gm
              WHERE gm.group_id = c.group_id AND gm.joined_at <= c.created_at
                AND NOT EXISTS (SELECT 1 FROM challenge_responses cr
                                 WHERE cr.challenge_id = c.id AND cr.user_id = gm.user_id)) AS waiting
       FROM challenges c WHERE c.id = $1`,
    [challengeId],
  );
  const row = state.rows[0];
  if (!row || row.status !== 'active' || row.waiting > 0) return null;
  return finalizeChallenge(challengeId, 'completed');
}

// ── Jobs ─────────────────────────────────────────────────────────

/** Finalize every active challenge past its expiry. Safe to run on several replicas. */
export async function expireDueChallenges(): Promise<number> {
  const events = await withTransaction(async (client) => {
    const due = await client.query<{ id: string }>(
      `SELECT id FROM challenges
        WHERE status = 'active' AND expires_at <= NOW()
        ORDER BY expires_at
        LIMIT 50
        FOR UPDATE SKIP LOCKED`,
    );
    const out: ChallengeFinalized[] = [];
    for (const { id } of due.rows) {
      const event = await finalizeOn(client, id, 'expired');
      if (event) out.push(event);
    }
    return out;
  });
  events.forEach(announceFinalized);
  return events.length;
}

/** One push, a minute before the end, to eligible members who haven't responded. */
export async function sendDueReminders(): Promise<number> {
  const due = await query<{ id: string; group_id: string }>(
    `UPDATE challenges SET reminder_sent_at = NOW()
      WHERE status = 'active' AND reminder_sent_at IS NULL
        AND expires_at > NOW() AND expires_at <= NOW() + INTERVAL '1 minute'
      RETURNING id, group_id`,
  );
  for (const c of due.rows) {
    const waiting = await query<{ user_id: string }>(
      `SELECT gm.user_id
         FROM group_members gm JOIN challenges ch ON ch.id = $1
        WHERE gm.group_id = ch.group_id AND gm.joined_at <= ch.created_at
          AND NOT EXISTS (SELECT 1 FROM challenge_responses cr WHERE cr.challenge_id = $1 AND cr.user_id = gm.user_id)`,
      [c.id],
    );
    await sendPushToUsers(
      waiting.rows.map((r) => r.user_id),
      'Last minute!',
      'Your group’s challenge closes in a minute — snap now',
      { type: 'challenge_reminder', challengeId: c.id, groupId: c.group_id },
    );
  }
  return due.rows.length;
}
