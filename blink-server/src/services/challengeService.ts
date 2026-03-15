import { query } from '../config/database';
import logger from '../utils/logger';
import { emitToGroup } from '../socket';
import { moderateImage, deleteS3Object, extractS3Key, logModerationResult } from './contentModeration';
import { commentOnResponses, AiPersonality } from './aiService';
import { processSkipsForChallenge } from './streakService';
import { ChallengeRow, GroupMemberRow, ChallengeResponseRow, CountRow } from '../types/db';

/** Error thrown when content moderation rejects an image */
export class ModerationError extends Error {
  labels: string[];
  confidence: number | undefined;
  constructor(labels: string[], confidence: number | undefined) {
    super('Your photo was flagged by our content moderation system and cannot be posted. Please try a different photo.');
    this.name = 'ModerationError';
    this.labels = labels;
    this.confidence = confidence;
  }
}

/**
 * Moderate an uploaded image (S3 only). Returns true if safe or not an S3 image.
 * Throws ModerationError if the image is rejected.
 */
export async function moderateResponseImage(
  photoUrl: string,
  userId: string,
  challengeId: string
): Promise<void> {
  const s3Key = extractS3Key(photoUrl);
  if (!s3Key) return; // not an S3 image, skip moderation

  const moderationResult = await moderateImage(s3Key);

  // Log every moderation check (async, fire-and-forget)
  logModerationResult(userId, s3Key, moderationResult).catch(() => {});

  if (!moderationResult.safe) {
    // Delete the offending image from S3
    await deleteS3Object(s3Key);

    logger.warn('Challenge response rejected by content moderation', {
      challengeId,
      userId,
      labels: moderationResult.labels,
      confidence: moderationResult.confidence,
    });

    throw new ModerationError(moderationResult.labels, moderationResult.confidence);
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
  answerText: string | null
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

  // Content moderation for S3 images
  if (photoUrl) {
    await moderateResponseImage(photoUrl, userId, challengeId);
  }

  // Insert response
  const responseType = (c.type === 'quiz' || c.type === 'prompt') ? 'answer' : 'photo';
  const result = await query<ChallengeResponseRow>(
    `INSERT INTO challenge_responses (challenge_id, user_id, response_type, photo_url, answer_index, answer_text, response_time_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [challengeId, userId, responseType, photoUrl, answerIndex ?? null, answerText || null, responseTimeMs || null]
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
  const totalMembers = await query<CountRow>(
    `SELECT COUNT(*) FROM group_members WHERE group_id = $1`,
    [groupId]
  );
  const totalResponses = await query<CountRow>(
    `SELECT COUNT(*) FROM challenge_responses WHERE challenge_id = $1`,
    [challengeId]
  );

  if (parseInt(totalResponses.rows[0].count) < parseInt(totalMembers.rows[0].count)) {
    return false;
  }

  await query(`UPDATE challenges SET status = 'completed' WHERE id = $1`, [challengeId]);
  await processSkipsForChallenge(challengeId, groupId);

  // Emit challenge completed event
  emitToGroup(groupId, 'challenge:completed', { challengeId, groupId });

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
     WHERE cr.challenge_id = $1 AND cr.response_type != 'skip'`,
    [challengeId]
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
