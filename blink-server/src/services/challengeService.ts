import { query, withTransaction } from '../config/database';
import { emitToGroup } from '../socket';
import { processSkipsForChallenge } from './streakService';
import { requireMember } from './membership';
import { HttpError } from '../utils/httpError';
import { sendPushToGroup } from './pushNotifications';
import { ChallengeRow, ChallengeResponseRow, CountRow } from '../types/db';

/**
 * Submit a response to a challenge. Validates preconditions, inserts the response,
 * triggers notifications, social obligation loop, streak rewards, and completion checks.
 *
 * Returns the inserted response row.
 * Throws on validation failures (not found, expired, not member, already responded).
 */
export async function submitResponse(
  challengeId: string,
  userId: string,
  responseTimeMs: number | null,
  // The client says "I will relay the bytes peer-to-peer" (E2E photo flow):
  // the server only records that a photo exists, never the photo itself.
  hasPhoto: boolean,
): Promise<{ response: ChallengeResponseRow; challenge: ChallengeRow }> {
  // Fetch challenge
  const challenge = await query<ChallengeRow>(`SELECT * FROM challenges WHERE id = $1`, [challengeId]);
  if (challenge.rows.length === 0) {
    throw new HttpError(404, 'Challenge not found');
  }
  const c = challenge.rows[0];

  if (c.status !== 'active' || new Date(c.expires_at) < new Date()) {
    throw new HttpError(400, 'This challenge has expired or is no longer active');
  }

  await requireMember(userId, { groupId: c.group_id });

  // Check duplicate response
  const existing = await query<Pick<ChallengeResponseRow, 'id'>>(
    `SELECT id FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
    [challengeId, userId],
  );
  if (existing.rows.length > 0) {
    throw new HttpError(400, 'Already responded');
  }

  const result = await query<ChallengeResponseRow>(
    `INSERT INTO challenge_responses (challenge_id, user_id, has_photo, response_time_ms)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [challengeId, userId, hasPhoto, responseTimeMs || null],
  );

  return { response: result.rows[0], challenge: c };
}

/**
 * Check if all group members have responded to a challenge.
 * If so, mark it as completed and settle member stats.
 */
export async function checkChallengeCompletion(challengeId: string, groupId: string): Promise<boolean> {
  const completed = await withTransaction(async (client) => {
    // Fetch the challenge's created_at to only count members who were in the group at that time
    const challengeResult = await client.query<{ created_at: Date; status: string }>(
      `SELECT created_at, status FROM challenges WHERE id = $1 FOR UPDATE`,
      [challengeId],
    );
    if (challengeResult.rows.length === 0 || challengeResult.rows[0].status !== 'active') {
      return false;
    }
    const challengeCreatedAt = challengeResult.rows[0].created_at;

    // Only count members who joined before the challenge was created
    const totalMembers = await client.query<CountRow>(
      `SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND joined_at <= $2`,
      [groupId, challengeCreatedAt],
    );
    const totalResponses = await client.query<CountRow>(
      `SELECT COUNT(*) FROM challenge_responses WHERE challenge_id = $1`,
      [challengeId],
    );

    if (parseInt(totalResponses.rows[0].count) < parseInt(totalMembers.rows[0].count)) {
      return false;
    }

    await client.query(`UPDATE challenges SET status = 'completed' WHERE id = $1 AND status = 'active'`, [challengeId]);
    return true;
  });

  if (!completed) {
    return false;
  }

  await processSkipsForChallenge(challengeId, groupId);

  // Emit challenge completed event
  emitToGroup(groupId, 'challenge:completed', { challengeId, groupId });

  // Push notification for challenge completion (fire-and-forget)
  sendPushToGroup(groupId, 'Challenge Complete!', 'Everyone responded — check out the results!', {
    type: 'challenge_completed',
    challengeId,
    groupId,
  }).catch(() => {});

  return true;
}
