import { Router, Response } from 'express';
import { query, withTransaction } from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../middleware/validate';
import { createChallengeSchema } from '../../utils/schemas';
import logger from '../../utils/logger';
import { CHALLENGE_COUNTDOWN_SECONDS } from '../../utils/constants';
import { emitToGroup } from '../../socket';
import { validateUuidParams } from '../../middleware/validateParams';
import { CHALLENGE_SELECT, getRandomQuiz } from './shared';
import { ChallengeRow } from '../../types/db';
import { processSkipsForChallenge } from '../../services/streakService';
import { notifyGroupOfChallenge } from '../../services/notificationService';
import { verifyMembership } from '../../services/groupService';

const router = Router();

// ── POST /api/challenges/groups/:groupId/challenges -- Trigger a challenge ──
router.post('/groups/:groupId/challenges', validateUuidParams('groupId'), validateBody(createChallengeSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const groupId = req.params.groupId as string;
  const { type } = req.body;

  try {
    await verifyMembership(req.userId!, groupId);
  } catch (err: unknown) {
    if (err instanceof Error && 'statusCode' in err) {
      const statusErr = err as Error & { statusCode: number };
      res.status(statusErr.statusCode).json({ error: statusErr.message });
      return;
    }
    throw err;
  }

  // Wrap entire create flow in a transaction to prevent race conditions
  const result = await withTransaction(async (client) => {
    // Advisory lock keyed on group_id to serialize challenge creation per group.
    // This closes the race window where two concurrent requests could both pass
    // the cooldown check before either INSERT commits (FOR UPDATE cannot lock
    // rows that don't exist yet).
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [groupId]
    );

    // Cooldown check: reject if a challenge was triggered in the last 5 seconds for this group.
    // The challenges table uses `triggered_at` (see migration 001) — no `created_at` column exists.
    const recentChallenge = await client.query(
      `SELECT id FROM challenges WHERE group_id = $1 AND triggered_at > NOW() - INTERVAL '5 seconds' ORDER BY triggered_at DESC LIMIT 1`,
      [groupId]
    );
    if (recentChallenge.rows.length > 0) {
      throw Object.assign(new Error('A challenge was just started'), { statusCode: 409 });
    }

    // Lock and expire any active challenges
    const activeChallenges = await client.query<Pick<ChallengeRow, 'id'>>(
      `SELECT id FROM challenges WHERE group_id = $1 AND status = 'active' FOR UPDATE`,
      [groupId]
    );
    const expiredChallengeIds = activeChallenges.rows.map((ac) => ac.id);
    if (expiredChallengeIds.length > 0) {
      await client.query(
        `UPDATE challenges SET status = 'expired' WHERE group_id = $1 AND status = 'active'`,
        [groupId]
      );
    }

    // Build challenge based on type
    let challengeType = 'snap';
    let promptText: string | null = null;
    let optionsJson: string | null = null;

    if (type === 'prompt') {
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
        const membersList = await client.query(
          `SELECT u.id, COALESCE(u.display_name, 'Anonymous') AS display_name FROM group_members gm
           JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1`,
          [groupId]
        );
        optionsJson = JSON.stringify(membersList.rows.map((m: Record<string, unknown>) => (m.display_name as string) || 'Anonymous'));
      } else {
        optionsJson = JSON.stringify(quiz.options);
      }
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const result = await client.query(
      `INSERT INTO challenges (group_id, type, prompt_text, options_json, triggered_by, expires_at, countdown_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${CHALLENGE_SELECT}`,
      [groupId, challengeType, promptText, optionsJson, req.userId, expiresAt, CHALLENGE_COUNTDOWN_SECONDS]
    );

    const row = result.rows[0];
    if (row.options && typeof row.options === 'string') {
      try { row.options = JSON.parse(row.options); } catch { /* keep as-is */ }
    }
    return { challenge: row, expiredChallengeIds };
  }).catch((err: unknown) => {
    if (err instanceof Error && 'statusCode' in err) {
      const statusErr = err as Error & { statusCode: number };
      res.status(statusErr.statusCode).json({ error: statusErr.message });
      return null;
    }
    throw err;
  });

  if (!result) return;
  const { challenge, expiredChallengeIds } = result;

  // Process skips for expired challenges AFTER transaction commits
  for (const expiredId of expiredChallengeIds) {
    processSkipsForChallenge(expiredId, groupId).catch((err: unknown) => {
      logger.error('Skip processing error', { error: err instanceof Error ? err.message : String(err), challengeId: expiredId });
    });
  }

  // Emit real-time event
  emitToGroup(groupId, 'challenge:started', challenge);

  // Notify all group members except trigger-er (fire-and-forget)
  notifyGroupOfChallenge(groupId, challenge.id, challenge.type, req.userId!).catch((err: unknown) => {
    logger.error('Challenge notification error', { error: err instanceof Error ? err.message : String(err), challengeId: challenge.id });
  });

  logger.info('Challenge triggered', { groupId, challengeId: challenge.id, type: challenge.type });
  res.status(201).json(challenge);
}));

export default router;
