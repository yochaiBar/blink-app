/**
 * One membership check for every route: resolve the group a target belongs
 * to and require the caller to be a member of it.
 */
import { query } from '../config/database';
import { HttpError } from '../utils/httpError';

export type MembershipTarget = { groupId: string } | { challengeId: string } | { responseId: string };

export interface Membership {
  groupId: string;
  role: 'admin' | 'member';
  joinedAt: Date;
  /** Set for challenge and response targets. */
  challengeId?: string;
  /** Set for response targets: who posted the response. */
  responseUserId?: string;
}

interface MembershipRow {
  group_id: string;
  role: 'admin' | 'member' | null;
  joined_at: Date | null;
  challenge_id?: string;
  response_user_id?: string;
}

/**
 * Throws HttpError 403 when `userId` is not a member, and 404 when a
 * challenge or response target doesn't exist. (A missing group answers 403,
 * like any group the caller isn't in, so group ids can't be probed.)
 */
export async function requireMember(userId: string, target: MembershipTarget): Promise<Membership> {
  let row: MembershipRow | undefined;

  if ('groupId' in target) {
    const result = await query<MembershipRow>(
      `SELECT group_id, role, joined_at FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [target.groupId, userId],
    );
    row = result.rows[0] ?? { group_id: target.groupId, role: null, joined_at: null };
  } else if ('challengeId' in target) {
    const result = await query<MembershipRow>(
      `SELECT c.group_id, c.id AS challenge_id, gm.role, gm.joined_at
         FROM challenges c
         LEFT JOIN group_members gm ON gm.group_id = c.group_id AND gm.user_id = $2
        WHERE c.id = $1`,
      [target.challengeId, userId],
    );
    row = result.rows[0];
    if (!row) throw new HttpError(404, 'Challenge not found');
  } else {
    const result = await query<MembershipRow>(
      `SELECT c.group_id, c.id AS challenge_id, cr.user_id AS response_user_id, gm.role, gm.joined_at
         FROM challenge_responses cr
         JOIN challenges c ON c.id = cr.challenge_id
         LEFT JOIN group_members gm ON gm.group_id = c.group_id AND gm.user_id = $2
        WHERE cr.id = $1`,
      [target.responseId, userId],
    );
    row = result.rows[0];
    if (!row) throw new HttpError(404, 'Response not found');
  }

  if (!row.role || !row.joined_at) throw new HttpError(403, 'Not a member of this group');
  return {
    groupId: row.group_id,
    role: row.role,
    joinedAt: row.joined_at,
    challengeId: row.challenge_id,
    responseUserId: row.response_user_id,
  };
}

/**
 * Like requireMember for a response, but a response by someone blocked with
 * the caller answers 404, as if it didn't exist: blocked users never see or
 * act on each other's content.
 */
export async function requireVisibleResponse(userId: string, responseId: string): Promise<Membership> {
  const membership = await requireMember(userId, { responseId });
  if (membership.responseUserId && membership.responseUserId !== userId) {
    const blocked = await query<{ blocked: boolean }>(`SELECT blocked_between($1, $2) AS blocked`, [
      userId,
      membership.responseUserId,
    ]);
    if (blocked.rows[0]?.blocked) throw new HttpError(404, 'Response not found');
  }
  return membership;
}
