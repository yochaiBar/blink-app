import { Router, Response } from 'express';
import { query } from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../middleware/validate';
import { createChallengeSchema } from '../../utils/schemas';
import logger from '../../utils/logger';
import { CHALLENGE_COUNTDOWN_SECONDS } from '../../utils/constants';
import { createNotification } from '../../utils/notifications';
import { emitToGroup } from '../../socket';
import { sendPushToGroup } from '../../services/pushNotifications';
import { validateUuidParams } from '../../middleware/validateParams';
import { CHALLENGE_SELECT, getRandomQuiz, processSkipsForChallenge } from './shared';
import { GroupMemberRow, ChallengeRow, UserDisplayNameRow } from '../../types/db';

const router = Router();

// ── POST /api/challenges/groups/:groupId/challenges — Trigger a challenge ──
router.post('/groups/:groupId/challenges', validateUuidParams('groupId'), validateBody(createChallengeSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const groupId = req.params.groupId as string;
  const { type } = req.body; // 'snap', 'quiz_food', 'quiz_most_likely', 'quiz_rate_day'

  const membership = await query<GroupMemberRow>(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, req.userId]
  );
  if (membership.rows.length === 0) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  // Expire any active challenge and process skips
  const activeChallenges = await query<Pick<ChallengeRow, 'id'>>(
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
        `SELECT u.id, COALESCE(u.display_name, u.phone_number) AS display_name FROM group_members gm
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
    `SELECT gm.user_id, COALESCE(u.display_name, u.phone_number) AS display_name FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1 AND gm.user_id != $2`,
    [groupId, req.userId]
  );
  const triggerUser = await query<UserDisplayNameRow>(`SELECT COALESCE(display_name, phone_number) AS display_name FROM users WHERE id = $1`, [req.userId]);
  const triggerName = triggerUser.rows[0]?.display_name || 'Someone';
  const groupInfo = await query<Pick<import('../../types/db').GroupRow, 'name'>>(`SELECT name FROM groups WHERE id = $1`, [groupId]);
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
    { type: 'challenge_started', challengeId: challenge.id, groupId, challengeType, screen: 'challenge' },
    req.userId
  ).catch(() => {});

  logger.info('Challenge triggered', { groupId, challengeId: challenge.id, type: challengeType });
  res.status(201).json(challenge);
}));

export default router;
