import { Router, Response } from 'express';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validate';
import { createChallengeSchema, respondChallengeSchema, addReactionSchema } from '../utils/schemas';
import logger from '../utils/logger';
import { CHALLENGE_COUNTDOWN_SECONDS } from '../utils/constants';
import { createNotification } from '../utils/notifications';
import { emitToGroup } from '../socket';
import { sendPushToGroup, sendPushToUser } from '../services/pushNotifications';
import { moderateImage, deleteS3Object, extractS3Key, logModerationResult } from '../services/contentModeration';

const router = Router();

router.use(authenticate);

// ── Preset quiz pools ──────────────────────────────────────────
// Column aliases to map DB schema names to client-expected field names.
// The DB uses triggered_by/triggered_at/prompt_text/options_json,
// but the client ApiChallenge type expects created_by/created_at/prompt/options.
const CHALLENGE_SELECT = `
  id, group_id, type,
  prompt_text as prompt,
  options_json as options,
  triggered_by as created_by,
  triggered_at as created_at,
  expires_at, status, countdown_seconds
`;

const QUIZ_PRESETS = {
  food: [
    { prompt: "What did you eat for lunch today?", options: ["Something healthy (sure...)", "Leftovers from 3 days ago", "Snacks count as a meal", "I forgot to eat"] },
    { prompt: "What's your go-to midnight snack?", options: ["Cereal at 2am like a champ", "Whatever's in the fridge", "I order delivery at midnight", "I sleep like a normal person"] },
    { prompt: "How would you describe your cooking skills?", options: ["Gordon Ramsay vibes", "I can boil water", "Microwave master", "Does cereal count?"] },
  ],
  most_likely: [
    { prompt: "Who in this group is most likely to fall asleep first at a sleepover?", options: [] },
    { prompt: "Who is most likely to accidentally send a text to the wrong person?", options: [] },
    { prompt: "Who is most likely to show up late to their own birthday?", options: [] },
    { prompt: "Who is most likely to cry during a movie?", options: [] },
    { prompt: "Who is most likely to survive a zombie apocalypse?", options: [] },
  ],
  rate_day: [
    { prompt: "Rate your day so far", options: ["1-3: Dumpster fire", "4-5: Meh", "6-7: Pretty decent", "8-10: Living my best life"] },
    { prompt: "How's your energy level right now?", options: ["Running on fumes", "Need coffee IV drip", "Surprisingly alive", "Unstoppable"] },
    { prompt: "How social are you feeling today?", options: ["Don't talk to me", "Small talk only", "Down to hang", "LET'S GO OUT"] },
  ],
};

function getRandomQuiz(type: 'food' | 'most_likely' | 'rate_day') {
  const pool = QUIZ_PRESETS[type];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Helper: process skip penalties when challenge expires ───────
async function processSkipsForChallenge(challengeId: string, groupId: string) {
  // Get all group members
  const members = await query(
    `SELECT user_id FROM group_members WHERE group_id = $1`,
    [groupId]
  );

  // Get who responded
  const responded = await query(
    `SELECT user_id FROM challenge_responses WHERE challenge_id = $1`,
    [challengeId]
  );
  const respondedIds = new Set(responded.rows.map((r: any) => r.user_id));

  // Get group penalty type
  const group = await query(`SELECT skip_penalty_type FROM groups WHERE id = $1`, [groupId]);
  const penaltyType = group.rows[0]?.skip_penalty_type || 'wanted_poster';

  // Increment total_challenges for all members
  await query(
    `UPDATE group_members SET total_challenges = total_challenges + 1 WHERE group_id = $1`,
    [groupId]
  );

  for (const member of members.rows) {
    if (respondedIds.has(member.user_id)) {
      // Responded: increment stats and streak
      await query(
        `UPDATE group_members
         SET total_responses = total_responses + 1,
             current_streak = current_streak + 1
         WHERE group_id = $1 AND user_id = $2`,
        [groupId, member.user_id]
      );
    } else {
      // Skipped: insert skip response, reset streak, apply penalty
      await query(
        `INSERT INTO challenge_responses (challenge_id, user_id, response_type)
         VALUES ($1, $2, 'skip')
         ON CONFLICT (challenge_id, user_id) DO NOTHING`,
        [challengeId, member.user_id]
      );

      await query(
        `UPDATE group_members SET current_streak = 0
         WHERE group_id = $1 AND user_id = $2`,
        [groupId, member.user_id]
      );

      // Apply penalty if not 'none'
      if (penaltyType !== 'none') {
        const SILLY_AVATARS = ['🤡', '🐸', '💩', '👻', '🤖', '👽', '🦄', '🐔'];
        const WANTED_TEXTS = [
          "WANTED: Last seen dodging group challenges",
          "MISSING IN ACTION: Probably napping",
          "WANTED: For crimes against group participation",
          "MIA: May have been abducted by aliens",
          "WANTED: Failed to blink in time",
        ];

        const penaltyData = penaltyType === 'avatar_change'
          ? { silly_avatar: SILLY_AVATARS[Math.floor(Math.random() * SILLY_AVATARS.length)] }
          : penaltyType === 'wanted_poster'
          ? { text: WANTED_TEXTS[Math.floor(Math.random() * WANTED_TEXTS.length)] }
          : { text: `${member.user_id} is the group's servant today! Send them tasks.` };

        await query(
          `INSERT INTO active_penalties (group_id, user_id, penalty_type, penalty_data, expires_at)
           VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')`,
          [groupId, member.user_id, penaltyType, JSON.stringify(penaltyData)]
        );
      }
    }
  }
}

// ── POST /api/groups/:groupId/challenges — Trigger a challenge ──
router.post('/groups/:groupId/challenges', validateBody(createChallengeSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const groupId = req.params.groupId as string;
  const { type } = req.body; // 'snap', 'quiz_food', 'quiz_most_likely', 'quiz_rate_day'

  const membership = await query(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, req.userId]
  );
  if (membership.rows.length === 0) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  // Expire any active challenge and process skips
  const activeChallenges = await query(
    `SELECT id FROM challenges WHERE group_id = $1 AND status = 'active'`,
    [groupId]
  );
  for (const ac of activeChallenges.rows) {
    await processSkipsForChallenge(ac.id, groupId);
  }
  await query(
    `UPDATE challenges SET status = 'expired' WHERE group_id = $1 AND status = 'active'`,
    [groupId]
  );

  // Build challenge based on type
  let challengeType = 'snap';
  let promptText: string | null = null;
  let optionsJson: string | null = null;

  if (type === 'prompt') {
    // Open-text or poll/quiz prompt created by user
    challengeType = 'prompt';
    promptText = req.body.prompt_text;
    if (req.body.options && req.body.options.length > 0) {
      optionsJson = JSON.stringify(req.body.options);
    }
  } else if (type && type.startsWith('quiz_')) {
    challengeType = 'quiz';
    const quizType = type.replace('quiz_', '') as 'food' | 'most_likely' | 'rate_day';
    const quiz = getRandomQuiz(quizType);
    promptText = quiz.prompt;

    if (quizType === 'most_likely') {
      // Options are group member names
      const membersList = await query(
        `SELECT u.id, u.display_name FROM group_members gm
         JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1`,
        [groupId]
      );
      optionsJson = JSON.stringify(membersList.rows.map((m: any) => m.display_name || 'Anonymous'));
    } else {
      optionsJson = JSON.stringify(quiz.options);
    }
  }

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const result = await query(
    `INSERT INTO challenges (group_id, type, prompt_text, options_json, triggered_by, expires_at, countdown_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${CHALLENGE_SELECT}`,
    [groupId, challengeType, promptText, optionsJson, req.userId, expiresAt, CHALLENGE_COUNTDOWN_SECONDS]
  );

  const challenge = result.rows[0];
  // Parse options_json string into an actual array for the client
  if (challenge.options && typeof challenge.options === 'string') {
    try { challenge.options = JSON.parse(challenge.options); } catch { /* keep as-is */ }
  }

  // Notify all group members except trigger-er
  const groupMembers = await query(
    `SELECT gm.user_id, u.display_name FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1 AND gm.user_id != $2`,
    [groupId, req.userId]
  );
  const triggerUser = await query(`SELECT display_name FROM users WHERE id = $1`, [req.userId]);
  const triggerName = triggerUser.rows[0]?.display_name || 'Someone';
  const groupInfo = await query(`SELECT name FROM groups WHERE id = $1`, [groupId]);
  const groupName = groupInfo.rows[0]?.name || 'your group';

  for (const member of groupMembers.rows) {
    await createNotification(
      member.user_id,
      'challenge_started',
      'New Challenge!',
      `${triggerName} started a ${challengeType} challenge in ${groupName}`,
      groupId,
      req.userId
    );
  }

  // Emit real-time event
  emitToGroup(groupId, 'challenge:started', challenge);

  // Fire-and-forget push notification to group members
  sendPushToGroup(
    groupId,
    'New Challenge!',
    `${triggerName} started a ${challengeType} challenge in ${groupName}`,
    { type: 'challenge_started', groupId, challengeId: challenge.id },
    req.userId
  ).catch(() => {});

  logger.info('Challenge triggered', { groupId, challengeId: challenge.id, type: challengeType });
  res.status(201).json(challenge);
}));

// ── GET active challenge ──
router.get('/groups/:groupId/challenges/active', asyncHandler(async (req: AuthRequest, res: Response) => {
  const groupId = req.params.groupId as string;

  const membership = await query(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, req.userId]
  );
  if (membership.rows.length === 0) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  // Auto-expire and process skips
  const expired = await query(
    `SELECT id FROM challenges
     WHERE group_id = $1 AND status = 'active' AND expires_at < NOW()`,
    [groupId]
  );
  for (const e of expired.rows) {
    await processSkipsForChallenge(e.id, groupId);
  }
  await query(
    `UPDATE challenges SET status = 'expired'
     WHERE group_id = $1 AND status = 'active' AND expires_at < NOW()`,
    [groupId]
  );

  const result = await query(
    `SELECT ${CHALLENGE_SELECT} FROM challenges WHERE group_id = $1 AND status = 'active' LIMIT 1`,
    [groupId]
  );

  if (result.rows.length === 0) {
    res.json(null);
    return;
  }

  const challenge = result.rows[0];
  // Parse options_json string into an actual array for the client
  if (challenge.options && typeof challenge.options === 'string') {
    try { challenge.options = JSON.parse(challenge.options); } catch { /* keep as-is */ }
  }

  const userResponse = await query(
    `SELECT id FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
    [challenge.id, req.userId]
  );

  res.json({
    ...challenge,
    user_has_responded: userResponse.rows.length > 0,
  });
}));

// ── POST respond to challenge ──
router.post('/:id/respond', validateBody(respondChallengeSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
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
    const responderUser = await query(`SELECT display_name FROM users WHERE id = $1`, [req.userId]);
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
  }

  logger.info('Challenge response submitted', { challengeId: id, userId: req.userId });
  res.status(201).json(result.rows[0]);
}));

// ── GET responses (can't peek until you play) ──
router.get('/:id/responses', asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  const userResponse = await query(
    `SELECT id FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
    [id, req.userId]
  );
  if (userResponse.rows.length === 0) {
    res.status(403).json({ error: "Can't peek until you play! Respond first." });
    return;
  }

  const responses = await query(
    `SELECT cr.*, u.display_name, u.avatar_url
     FROM challenge_responses cr
     JOIN users u ON u.id = cr.user_id
     WHERE cr.challenge_id = $1
     ORDER BY cr.responded_at`,
    [id]
  );

  // Fetch reactions for all responses in this challenge
  const responseIds = responses.rows.map((r: any) => r.id);
  let reactionsMap: Record<string, { emoji: string; count: number; users: string[] }[]> = {};

  if (responseIds.length > 0) {
    const reactions = await query(
      `SELECT r.response_id, r.emoji, COUNT(*) as count,
              ARRAY_AGG(u.display_name) as user_names
       FROM reactions r
       JOIN users u ON u.id = r.user_id
       WHERE r.response_id = ANY($1)
       GROUP BY r.response_id, r.emoji
       ORDER BY count DESC`,
      [responseIds]
    );

    for (const row of reactions.rows) {
      if (!reactionsMap[row.response_id]) {
        reactionsMap[row.response_id] = [];
      }
      reactionsMap[row.response_id].push({
        emoji: row.emoji,
        count: parseInt(row.count),
        users: row.user_names,
      });
    }
  }

  const responsesWithReactions = responses.rows.map((r: any) => ({
    ...r,
    reactions: reactionsMap[r.id] || [],
  }));

  res.json(responsesWithReactions);
}));

// ── GET challenge history ──
router.get('/groups/:groupId/challenges/history', asyncHandler(async (req: AuthRequest, res: Response) => {
  const groupId = req.params.groupId as string;

  const membership = await query(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, req.userId]
  );
  if (membership.rows.length === 0) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  const result = await query(
    `SELECT c.id, c.group_id, c.type,
       c.prompt_text as prompt,
       c.options_json as options,
       c.triggered_by as created_by,
       c.triggered_at as created_at,
       c.expires_at, c.status, c.countdown_seconds,
       (SELECT COUNT(*) FROM challenge_responses WHERE challenge_id = c.id AND response_type != 'skip') as response_count,
       (SELECT COUNT(*)::int FROM group_members WHERE group_id = c.group_id) as member_count,
       EXISTS(SELECT 1 FROM challenge_responses WHERE challenge_id = c.id AND user_id = $2 AND response_type != 'skip') as user_responded
     FROM challenges c
     WHERE c.group_id = $1 AND c.status IN ('completed', 'expired')
     ORDER BY c.triggered_at DESC
     LIMIT 20`,
    [groupId, req.userId]
  );

  // Parse options strings into arrays
  for (const row of result.rows) {
    if (row.options && typeof row.options === 'string') {
      try { row.options = JSON.parse(row.options); } catch { /* keep as-is */ }
    }
  }

  res.json(result.rows);
}));

// ── POST /api/challenges/responses/:responseId/reactions — Add reaction ──
router.post('/responses/:responseId/reactions', validateBody(addReactionSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { responseId } = req.params;
  const { emoji } = req.body;

  // Verify the response exists
  const response = await query(
    `SELECT cr.*, c.group_id FROM challenge_responses cr
     JOIN challenges c ON c.id = cr.challenge_id
     WHERE cr.id = $1`,
    [responseId]
  );
  if (response.rows.length === 0) {
    res.status(404).json({ error: 'Response not found' });
    return;
  }

  // Verify user is a member of the group
  const membership = await query(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [response.rows[0].group_id, req.userId]
  );
  if (membership.rows.length === 0) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  const result = await query(
    `INSERT INTO reactions (response_id, user_id, emoji)
     VALUES ($1, $2, $3)
     ON CONFLICT (response_id, user_id, emoji) DO NOTHING
     RETURNING *`,
    [responseId, req.userId, emoji]
  );

  if (result.rows.length === 0) {
    res.status(409).json({ error: 'Reaction already exists' });
    return;
  }

  // Fire-and-forget push notification to the response owner
  const responseOwner = response.rows[0].user_id;
  if (responseOwner && responseOwner !== req.userId) {
    const reactorUser = await query(`SELECT display_name FROM users WHERE id = $1`, [req.userId]);
    const reactorName = reactorUser.rows[0]?.display_name || 'Someone';
    sendPushToUser(
      responseOwner,
      'New Reaction!',
      `${reactorName} reacted ${emoji} to your photo`,
      { type: 'reaction', responseId, groupId: response.rows[0].group_id }
    ).catch(() => {});
  }

  logger.info('Reaction added', { responseId, userId: req.userId, emoji });
  res.status(201).json(result.rows[0]);
}));

// ── DELETE /api/challenges/responses/:responseId/reactions/:emoji — Remove reaction ──
router.delete('/responses/:responseId/reactions/:emoji', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { responseId, emoji } = req.params;

  const result = await query(
    `DELETE FROM reactions
     WHERE response_id = $1 AND user_id = $2 AND emoji = $3
     RETURNING *`,
    [responseId, req.userId, emoji]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Reaction not found' });
    return;
  }

  logger.info('Reaction removed', { responseId, userId: req.userId, emoji });
  res.json({ message: 'Reaction removed' });
}));

export default router;
