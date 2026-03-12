import { Router, Response } from 'express';
import { query } from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../middleware/validate';
import { respondChallengeSchema } from '../../utils/schemas';
import logger from '../../utils/logger';
import { createNotification } from '../../utils/notifications';
import { emitToGroup } from '../../socket';
import { sendPushToGroup, sendPushToUser } from '../../services/pushNotifications';
import { moderateImage, deleteS3Object, extractS3Key, logModerationResult } from '../../services/contentModeration';
import { commentOnResponses, AiPersonality } from '../../services/aiService';
import { validateUuidParams } from '../../middleware/validateParams';
import { processSkipsForChallenge } from './shared';

const router = Router();

// ── POST respond to challenge ──
router.post('/:id/respond', validateUuidParams('id'), validateBody(respondChallengeSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { photo_url, photo_base64, response_time_ms, answer_index, answer_text } = req.body;
  // Accept either photo_url or photo_base64 (data URI from camera)
  const resolvedPhotoUrl = photo_url || photo_base64 || null;

  const challenge = await query(`SELECT * FROM challenges WHERE id = $1`, [id]);
  if (challenge.rows.length === 0) {
    res.status(404).json({ error: 'Challenge not found' });
    return;
  }

  const c = challenge.rows[0];

  if (c.status !== 'active' || new Date(c.expires_at) < new Date()) {
    res.status(400).json({ error: 'This challenge has expired or is no longer active' });
    return;
  }

  const membership = await query(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [c.group_id, req.userId]
  );
  if (membership.rows.length === 0) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  const existing = await query(
    `SELECT id FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
    [id, req.userId]
  );
  if (existing.rows.length > 0) {
    res.status(400).json({ error: 'Already responded' });
    return;
  }

  // ── Content moderation for S3 images ──────────────────────────
  if (resolvedPhotoUrl) {
    const s3Key = extractS3Key(resolvedPhotoUrl);
    if (s3Key) {
      const moderationResult = await moderateImage(s3Key);

      // Log every moderation check (async, fire-and-forget)
      logModerationResult(req.userId!, s3Key, moderationResult).catch(() => {});

      if (!moderationResult.safe) {
        // Delete the offending image from S3
        await deleteS3Object(s3Key);

        logger.warn('Challenge response rejected by content moderation', {
          challengeId: id,
          userId: req.userId,
          labels: moderationResult.labels,
          confidence: moderationResult.confidence,
        });

        res.status(400).json({
          error: 'Your photo was flagged by our content moderation system and cannot be posted. Please try a different photo.',
          moderation_labels: moderationResult.labels,
        });
        return;
      }
    }
  }

  const responseType = (c.type === 'quiz' || c.type === 'prompt') ? 'answer' : 'photo';
  const result = await query(
    `INSERT INTO challenge_responses (challenge_id, user_id, response_type, photo_url, answer_index, answer_text, response_time_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, req.userId, responseType, resolvedPhotoUrl, answer_index ?? null, answer_text || null, response_time_ms || null]
  );

  // Notify the challenge trigger-er that someone responded
  if (c.triggered_by && c.triggered_by !== req.userId) {
    const responderUser = await query(`SELECT COALESCE(display_name, phone_number) AS display_name FROM users WHERE id = $1`, [req.userId]);
    const responderName = responderUser.rows[0]?.display_name || 'Someone';
    await createNotification(
      c.triggered_by,
      'snap_received',
      'New Response!',
      `${responderName} responded to your challenge`,
      c.group_id,
      req.userId
    );

    // Fire-and-forget push notification to challenge creator
    sendPushToUser(
      c.triggered_by,
      'New Response!',
      `${responderName} responded to your challenge`,
      { type: 'snap_received', groupId: c.group_id, challengeId: id }
    ).catch(() => {});
  }

  // Emit real-time event for the response
  emitToGroup(c.group_id, 'challenge:response', {
    challengeId: id,
    response: result.rows[0],
  });

  // ── Social Obligation Loop: notify non-responders ──────────────
  try {
    // Get all group members with names
    const allMembers = await query(
      `SELECT gm.user_id, COALESCE(u.display_name, u.phone_number) AS display_name, u.avatar_url
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1`,
      [c.group_id]
    );

    // Get who has responded so far (non-skip)
    const allResponded = await query(
      `SELECT cr.user_id, COALESCE(u.display_name, u.phone_number) AS display_name, u.avatar_url
       FROM challenge_responses cr
       JOIN users u ON u.id = cr.user_id
       WHERE cr.challenge_id = $1 AND cr.response_type != 'skip'`,
      [id]
    );
    const respondedUserIds = new Set(allResponded.rows.map((r: any) => r.user_id));

    // Emit challenge:progress socket event
    emitToGroup(c.group_id, 'challenge:progress', {
      challengeId: id,
      respondedCount: allResponded.rows.length,
      totalMembers: allMembers.rows.length,
      respondedUsers: allResponded.rows.map((r: any) => ({
        userId: r.user_id,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
      })),
    });

    // Build personalized push messages for non-responders
    const respondedNames = allResponded.rows.map((r: any) => r.display_name || 'Someone');
    const nonResponders = allMembers.rows.filter((m: any) => !respondedUserIds.has(m.user_id));

    for (const pending of nonResponders) {
      let pushBody: string;
      if (respondedNames.length === 1) {
        pushBody = `${respondedNames[0]} already responded. Your turn!`;
      } else if (respondedNames.length === 2) {
        pushBody = `${respondedNames[0]} and ${respondedNames[1]} already responded — don't leave them hanging!`;
      } else {
        const othersCount = respondedNames.length - 2;
        pushBody = `${respondedNames[0]}, ${respondedNames[1]} and ${othersCount} other${othersCount > 1 ? 's' : ''} responded — you're the only ones left!`;
      }

      sendPushToUser(
        pending.user_id,
        'Your friends are waiting!',
        pushBody,
        { type: 'social_obligation', groupId: c.group_id, challengeId: id }
      ).catch(() => {});
    }
  } catch (err: any) {
    logger.error('Social obligation loop error', { error: err.message, challengeId: id });
  }

  // ── Streak Shield Earning + Milestone Checks ──────────────────
  try {
    // Get the user's current streak (before this challenge's processSkips runs)
    const streakResult = await query(
      `SELECT current_streak FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [c.group_id, req.userId]
    );
    const currentStreak = streakResult.rows[0]?.current_streak || 0;
    // The streak will be incremented by processSkipsForChallenge, so the "new" streak = currentStreak + 1
    // But processSkips hasn't run yet for active challenges, so we simulate the upcoming value
    const upcomingStreak = currentStreak + 1;

    // Streak Shield: earned every 7-day streak
    if (upcomingStreak > 0 && upcomingStreak % 7 === 0) {
      await query(
        `INSERT INTO streak_shields (user_id, group_id) VALUES ($1, $2)`,
        [req.userId, c.group_id]
      );
      sendPushToUser(
        req.userId!,
        'Streak Shield Earned!',
        "You earned a Streak Shield! It'll protect your streak if you miss a challenge.",
        { type: 'streak_shield_earned', groupId: c.group_id }
      ).catch(() => {});
      logger.info('Streak shield earned', { userId: req.userId, groupId: c.group_id, streak: upcomingStreak });
    }

    // Streak Milestones
    const MILESTONES = [3, 7, 14, 30, 50, 100];
    if (MILESTONES.includes(upcomingStreak)) {
      await query(
        `INSERT INTO streak_milestones (user_id, group_id, milestone) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [req.userId, c.group_id, upcomingStreak]
      );

      const userName = await query(`SELECT COALESCE(display_name, phone_number) AS display_name FROM users WHERE id = $1`, [req.userId]);
      const displayName = userName.rows[0]?.display_name || 'Someone';

      sendPushToUser(
        req.userId!,
        'Streak Milestone!',
        `Amazing! You hit a ${upcomingStreak}-day streak!`,
        { type: 'streak_milestone', groupId: c.group_id, milestone: upcomingStreak }
      ).catch(() => {});

      // Notify the group
      sendPushToGroup(
        c.group_id,
        'Streak Milestone!',
        `${displayName} just hit a ${upcomingStreak}-day streak! 🔥`,
        { type: 'streak_milestone', groupId: c.group_id, userId: req.userId, milestone: upcomingStreak },
        req.userId
      ).catch(() => {});

      emitToGroup(c.group_id, 'streak:milestone', {
        userId: req.userId,
        displayName,
        milestone: upcomingStreak,
        groupId: c.group_id,
      });
    }
  } catch (err: any) {
    logger.error('Streak enhancement error', { error: err.message, challengeId: id, userId: req.userId });
  }

  // Check if all responded -> complete
  const totalMembers = await query(
    `SELECT COUNT(*) FROM group_members WHERE group_id = $1`,
    [c.group_id]
  );
  const totalResponses = await query(
    `SELECT COUNT(*) FROM challenge_responses WHERE challenge_id = $1`,
    [id]
  );
  if (parseInt(totalResponses.rows[0].count) >= parseInt(totalMembers.rows[0].count)) {
    await query(`UPDATE challenges SET status = 'completed' WHERE id = $1`, [id]);
    await processSkipsForChallenge(id, c.group_id);

    // Emit challenge completed event
    emitToGroup(c.group_id, 'challenge:completed', { challengeId: id, groupId: c.group_id });

    // AI commentary on challenge results (fire-and-forget)
    try {
      const groupPersonalityResult = await query(`SELECT ai_personality FROM groups WHERE id = $1`, [c.group_id]);
      const personality: AiPersonality = groupPersonalityResult.rows[0]?.ai_personality || 'funny';
      const allResponsesForCommentary = await query(
        `SELECT cr.answer_text, cr.response_time_ms, COALESCE(u.display_name, u.phone_number) AS display_name
         FROM challenge_responses cr
         JOIN users u ON u.id = cr.user_id
         WHERE cr.challenge_id = $1 AND cr.response_type != 'skip'`,
        [id]
      );
      const responsesData = allResponsesForCommentary.rows.map((r: any) => ({
        userName: r.display_name || 'Someone',
        answerText: r.answer_text || undefined,
        responseTimeMs: r.response_time_ms || undefined,
      }));
      if (responsesData.length > 0) {
        const commentary = await commentOnResponses(responsesData, personality);
        // Cache the commentary on the challenge row for later retrieval via /reveal
        await query(`UPDATE challenges SET ai_commentary = $1 WHERE id = $2`, [commentary.commentary, id]);
        emitToGroup(c.group_id, 'challenge:commentary', { challengeId: id, commentary: commentary.commentary });
      }
    } catch (err: any) {
      logger.error('AI commentary generation failed', { error: err.message, challengeId: id });
    }
  }

  logger.info('Challenge response submitted', { challengeId: id, userId: req.userId });
  res.status(201).json(result.rows[0]);
}));

export default router;
