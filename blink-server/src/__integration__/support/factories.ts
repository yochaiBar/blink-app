/**
 * SQL factories: insert real rows straight into the test database. Use
 * them to arrange state; exercise behaviour through the HTTP API.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { query } from '../../config/database';
import { JWT_ACCESS_EXPIRY } from '../../utils/constants';
import type { ChallengeResponseRow, ChallengeRow, GroupRow, UserRow } from '../../types/db';

let phoneCounter = 0;

export interface TestUser extends UserRow {
  /** A valid access token, verified by the real authenticate middleware. */
  token: string;
}

export function accessTokenFor(userId: string): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET as string, { expiresIn: JWT_ACCESS_EXPIRY });
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
  return { ...user, token: accessTokenFor(user.id) };
}

export async function addMember(groupId: string, userId: string, role: 'admin' | 'member' = 'member'): Promise<void> {
  await query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)`, [groupId, userId, role]);
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
 * A snap challenge that was triggered 5 minutes before it expires. Pass a
 * negative `expiresInSeconds` to arrange an expired-but-still-'active' one.
 * Times are computed in SQL so they share the session clock with NOW().
 */
export async function createChallenge(opts: {
  groupId: string;
  triggeredBy: { id: string };
  expiresInSeconds?: number;
  status?: 'active' | 'completed' | 'expired';
}): Promise<ChallengeRow> {
  const result = await query<ChallengeRow>(
    `INSERT INTO challenges (group_id, type, triggered_by, triggered_at, expires_at, status)
     VALUES ($1, 'snap', $2,
             NOW() + make_interval(secs => $3) - INTERVAL '5 minutes',
             NOW() + make_interval(secs => $3),
             $4)
     RETURNING *`,
    [opts.groupId, opts.triggeredBy.id, opts.expiresInSeconds ?? 300, opts.status ?? 'active'],
  );
  return result.rows[0];
}

export async function createResponse(opts: {
  challengeId: string;
  user: { id: string };
  hasPhoto?: boolean;
}): Promise<ChallengeResponseRow> {
  const result = await query<ChallengeResponseRow>(
    `INSERT INTO challenge_responses (challenge_id, user_id, response_type, has_photo, response_time_ms)
     VALUES ($1, $2, 'photo', $3, 1500)
     RETURNING *`,
    [opts.challengeId, opts.user.id, opts.hasPhoto ?? true],
  );
  return result.rows[0];
}

export async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const result = await query<{ count: string }>(sql, params);
  return parseInt(result.rows[0].count, 10);
}
