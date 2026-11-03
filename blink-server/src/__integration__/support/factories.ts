/**
 * SQL factories: insert real rows straight into the test database. Use
 * them to arrange state; exercise behaviour through the HTTP API.
 */
import crypto from 'crypto';
import { query } from '../../config/database';
import { createSession } from '../../services/authSessions';
import type { ChallengeResponseRow, ChallengeRow, GroupRow, UserRow } from '../../types/db';

let phoneCounter = 0;

export interface TestUser extends UserRow {
  /** Access token of a real auth_sessions row, accepted by the real authenticate middleware. */
  token: string;
  refreshToken: string;
}

export function bearer(user: { token: string }): { Authorization: string } {
  return { Authorization: `Bearer ${user.token}` };
}

export async function createUser(overrides: { phone_number?: string; display_name?: string } = {}): Promise<TestUser> {
  phoneCounter += 1;
  const phone = overrides.phone_number ?? `+1555${String(phoneCounter).padStart(7, '0')}`;
  const result = await query<UserRow>(`INSERT INTO users (phone_number, display_name) VALUES ($1, $2) RETURNING *`, [
    phone,
    overrides.display_name ?? `User ${phoneCounter}`,
  ]);
  const user = result.rows[0];
  const tokens = await createSession(user.id);
  return { ...user, token: tokens.access_token, refreshToken: tokens.refresh_token };
}

/**
 * Members join a day before "now" by default, so they're eligible for
 * factory challenges (which are backdated). Pass `joinedSecondsAgo: 0` for
 * a member who joined after a challenge started.
 */
export async function addMember(
  groupId: string,
  userId: string,
  role: 'admin' | 'member' = 'member',
  joinedSecondsAgo = 24 * 3600,
): Promise<void> {
  await query(
    `INSERT INTO group_members (group_id, user_id, role, joined_at)
     VALUES ($1, $2, $3, NOW() - make_interval(secs => $4))`,
    [groupId, userId, role, joinedSecondsAgo],
  );
}

/** A group created by `createdBy` (as admin), plus any extra members. */
export async function createGroup(opts: {
  createdBy: { id: string };
  members?: { id: string }[];
  maxMembers?: number;
  name?: string;
}): Promise<GroupRow> {
  const inviteCode = crypto.randomBytes(6).toString('hex').toUpperCase();
  const result = await query<GroupRow>(
    `INSERT INTO groups (name, created_by, invite_code, max_members)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [opts.name ?? 'Test Group', opts.createdBy.id, inviteCode, opts.maxMembers ?? 15],
  );
  const group = result.rows[0];
  await addMember(group.id, opts.createdBy.id, 'admin');
  for (const member of opts.members ?? []) {
    await addMember(group.id, member.id);
  }
  return group;
}

/**
 * A snap challenge created 5 minutes before it expires. Pass a negative
 * `expiresInSeconds` to arrange an expired-but-still-'active' one.
 * Times are computed in SQL so they share the session clock with NOW().
 */
export async function createChallenge(opts: {
  groupId: string;
  /** null = created by the scheduler. */
  createdBy: { id: string } | null;
  expiresInSeconds?: number;
  status?: 'active' | 'completed' | 'expired';
  prompt?: string;
}): Promise<ChallengeRow> {
  const result = await query<ChallengeRow>(
    `INSERT INTO challenges (group_id, created_by, prompt, created_at, expires_at, status, is_auto_generated)
     VALUES ($1, $2::uuid, $5,
             NOW() + make_interval(secs => $3) - INTERVAL '5 minutes',
             NOW() + make_interval(secs => $3),
             $4, $2::uuid IS NULL)
     RETURNING *`,
    [
      opts.groupId,
      opts.createdBy?.id ?? null,
      opts.expiresInSeconds ?? 300,
      opts.status ?? 'active',
      opts.prompt ?? null,
    ],
  );
  return result.rows[0];
}

export async function memberStats(groupId: string) {
  const result = await query<{
    user_id: string;
    total_challenges: number;
    total_responses: number;
    current_streak: number;
  }>('SELECT user_id, total_challenges, total_responses, current_streak FROM group_members WHERE group_id = $1', [
    groupId,
  ]);
  return Object.fromEntries(result.rows.map((r) => [r.user_id, r]));
}

export async function createResponse(opts: {
  challengeId: string;
  user: { id: string };
  hasPhoto?: boolean;
}): Promise<ChallengeResponseRow> {
  const result = await query<ChallengeResponseRow>(
    `INSERT INTO challenge_responses (challenge_id, user_id, has_photo, response_time_ms)
     VALUES ($1, $2, $3, 1500)
     RETURNING *`,
    [opts.challengeId, opts.user.id, opts.hasPhoto ?? true],
  );
  return result.rows[0];
}

export async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const result = await query<{ count: string }>(sql, params);
  return parseInt(result.rows[0].count, 10);
}

/** Register a device public key for `user` (random bytes; the server never uses it). */
export async function registerDeviceKey(
  user: { id: string },
  deviceId: string = crypto.randomUUID(),
): Promise<{ deviceId: string; publicKeyB64: string }> {
  const publicKeyB64 = crypto.randomBytes(32).toString('base64');
  await query(
    `INSERT INTO device_public_keys (user_id, device_id, x25519_public_key, attestation) VALUES ($1, $2, $3, $4)`,
    [user.id, deviceId, publicKeyB64, crypto.randomBytes(32).toString('base64')],
  );
  return { deviceId, publicKeyB64 };
}

/** Record that `user`'s device holds the group key at `version` (as /keyshare/confirm would). */
export async function holdKey(groupId: string, user: { id: string }, version = 1): Promise<void> {
  await query(`UPDATE group_members SET key_version = $3 WHERE group_id = $1 AND user_id = $2`, [
    groupId,
    user.id,
    version,
  ]);
}

export async function block(blocker: { id: string }, blocked: { id: string }): Promise<void> {
  await query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [blocker.id, blocked.id]);
}

/** Give `user` an Expo push token, so pushes to them reach the HTTP stub. */
export async function setPushToken(user: { id: string }): Promise<string> {
  const token = `ExponentPushToken[${user.id}]`;
  await query(`UPDATE users SET push_token = $1 WHERE id = $2`, [token, user.id]);
  return token;
}

export async function createComment(opts: {
  responseId: string;
  user: { id: string };
  text?: string;
  parentId?: string;
}): Promise<{ id: string }> {
  const result = await query<{ id: string }>(
    `INSERT INTO response_comments (response_id, user_id, parent_comment_id, text)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.responseId, opts.user.id, opts.parentId ?? null, opts.text ?? 'nice'],
  );
  return result.rows[0];
}

export async function createReaction(opts: {
  responseId: string;
  user: { id: string };
  emoji?: string;
}): Promise<void> {
  await query(`INSERT INTO reactions (response_id, user_id, emoji) VALUES ($1, $2, $3)`, [
    opts.responseId,
    opts.user.id,
    opts.emoji ?? '🔥',
  ]);
}

/** Wait until the push stub has recorded a request satisfying `predicate`. */
export async function waitForPush(
  predicate: (tokens: string[]) => boolean,
  requests: { body: unknown }[],
  timeoutMs = 2000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tokens = requests
      .flatMap((r) => (Array.isArray(r.body) ? r.body : [r.body]))
      .map((m) => (m as { to: string }).to);
    if (predicate(tokens)) return tokens;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected push request was not sent');
}
