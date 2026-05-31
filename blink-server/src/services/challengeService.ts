import { query, withTransaction } from '../config/database';
import logger from '../utils/logger';
import { emitToGroup } from '../socket';
import { commentOnResponses, AiPersonality } from './aiService';
import { processSkipsForChallenge } from './streakService';
import { sendPushToGroup } from './pushNotifications';
import { ChallengeRow, GroupMemberRow, ChallengeResponseRow, CountRow } from '../types/db';

/**
 * Legacy moderation error type — retained so existing test fixtures and any
 * remaining `instanceof ModerationError` checks compile. Server-side image
 * moderation is gone (Phase 6: photos no longer reach the server). Future
 * cleanup can drop this class entirely once all references are gone.
 */
export class ModerationError extends Error {
  labels: string[];
  confidence: number | undefined;
  constructor(labels: string[], confidence: number | undefined) {
    super('Your photo was flagged. Please try a different photo.');
    this.name = 'ModerationError';
    this.labels = labels;
    this.confidence = confidence;
  }
}

/**
 * Submit a response to a challenge. Validates preconditions, inserts the response,
 * triggers notifications, social obligation loop, streak rewards, and completion checks.
 *
 * Returns the inserted response row.
 * Throws on validation failures (not found, expired, not member, already responded, moderation).
 */
export async function submitResponse(
  challengeId: string,
  userId: string,
  photoUrl: string | null,
  responseTimeMs: number | null,
  answerIndex: number | null,
  answerText: string | null,
  // v2 photo flow: client says "I will relay the bytes peer-to-peer."
  // No photo_url; recipients fetch from their local sandbox once the
  // /api/photos/relay arrives. Either path sets has_photo=true; only
  // pure answers (quiz / prompt with no media) stay has_photo=false.
  explicitHasPhoto?: boolean,
): Promise<{ response: ChallengeResponseRow; challenge: ChallengeRow }> {
  // Fetch challenge
  const challenge = await query<ChallengeRow>(`SELECT * FROM challenges WHERE id = $1`, [challengeId]);
  if (challenge.rows.length === 0) {
    throw Object.assign(new Error('Challenge not found'), { statusCode: 404 });
  }
  const c = challenge.rows[0];

  if (c.status !== 'active' || new Date(c.expires_at) < new Date()) {
    throw Object.assign(new Error('This challenge has expired or is no longer active'), { statusCode: 400 });
  }

  // Verify membership
  const membership = await query<GroupMemberRow>(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [c.group_id, userId]
  );
  if (membership.rows.length === 0) {
    throw Object.assign(new Error('Not a member of this group'), { statusCode: 403 });
  }

  // Check duplicate response
  const existing = await query<Pick<ChallengeResponseRow, 'id'>>(
    `SELECT id FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
    [challengeId, userId]
  );
  if (existing.rows.length > 0) {
    throw Object.assign(new Error('Already responded'), { statusCode: 400 });
  }

  // (Phase 6: no server-side moderation — photos no longer reach the server.
  // Reporting + block-list remain as the user-driven safety surface.)

  // Insert response. has_photo = either v1 (photo_url set, legacy clients
  // before HTTP 426 cutover) or v2 (client signaled explicitly).
  const responseType = (c.type === 'quiz' || c.type === 'prompt') ? 'answer' : 'photo';
  const hasPhoto = explicitHasPhoto === true || photoUrl != null;
  const result = await query<ChallengeResponseRow>(
    `INSERT INTO challenge_responses (challenge_id, user_id, response_type, photo_url, has_photo, answer_index, answer_text, response_time_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [challengeId, userId, responseType, photoUrl, hasPhoto, answerIndex ?? null, answerText || null, responseTimeMs || null]
  );

  return { response: result.rows[0], challenge: c };
}

/**
 * Check if all group members have responded to a challenge.
 * If so, mark it as completed, process skips, trigger AI commentary.
 */
export async function checkChallengeCompletion(
  challengeId: string,
  groupId: string
): Promise<boolean> {
  const completed = await withTransaction(async (client) => {
    // Fetch the challenge's created_at to only count members who were in the group at that time
    const challengeResult = await client.query<{ created_at: Date; status: string }>(
      `SELECT created_at, status FROM challenges WHERE id = $1 FOR UPDATE`,
      [challengeId]
    );
    if (challengeResult.rows.length === 0 || challengeResult.rows[0].status !== 'active') {
      return false;
    }
    const challengeCreatedAt = challengeResult.rows[0].created_at;

    // Only count members who joined before the challenge was created
    const totalMembers = await client.query<CountRow>(
      `SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND joined_at <= $2`,
      [groupId, challengeCreatedAt]
    );
    const totalResponses = await client.query<CountRow>(
      `SELECT COUNT(*) FROM challenge_responses WHERE challenge_id = $1`,
      [challengeId]
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
  sendPushToGroup(
    groupId,
    'Challenge Complete!',
    'Everyone responded — check out the results!',
    { type: 'challenge_completed', challengeId, groupId },
  ).catch(() => {});

  // AI commentary on challenge results (fire-and-forget)
  generateAiCommentary(challengeId, groupId).catch((err: unknown) => {
    logger.error('AI commentary generation failed', { error: err instanceof Error ? err.message : String(err), challengeId });
  });

  return true;
}

/**
 * Generate AI commentary for a completed challenge and cache it.
 */
async function generateAiCommentary(challengeId: string, groupId: string): Promise<void> {
  const groupPersonalityResult = await query(`SELECT ai_personality FROM groups WHERE id = $1`, [groupId]);
  const personality: AiPersonality = groupPersonalityResult.rows[0]?.ai_personality || 'funny';
  const allResponsesForCommentary = await query(
    `SELECT cr.answer_text, cr.response_time_ms, COALESCE(u.display_name, u.phone_number) AS display_name
     FROM challenge_responses cr
     JOIN users u ON u.id = cr.user_id
     JOIN group_members gm ON gm.group_id = $2 AND gm.user_id = cr.user_id
     WHERE cr.challenge_id = $1 AND cr.response_type != 'skip'`,
    [challengeId, groupId]
  );
  const responsesData = allResponsesForCommentary.rows.map((r) => ({
    userName: r.display_name || 'Someone',
    answerText: r.answer_text || undefined,
    responseTimeMs: r.response_time_ms || undefined,
  }));
  if (responsesData.length > 0) {
    const commentary = await commentOnResponses(responsesData, personality);
    await query(`UPDATE challenges SET ai_commentary = $1 WHERE id = $2`, [commentary.commentary, challengeId]);
    emitToGroup(groupId, 'challenge:commentary', { challengeId, commentary: commentary.commentary });
  }
}
