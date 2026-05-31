import { Router, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../middleware/validate';
import { respondChallengeSchema } from '../../utils/schemas';
import logger from '../../utils/logger';
import { emitToGroup } from '../../socket';
import { validateUuidParams } from '../../middleware/validateParams';
import { submitResponse, checkChallengeCompletion, ModerationError } from '../../services/challengeService';
import { notifyUserOfResponse, notifySocialObligation } from '../../services/notificationService';
import { processStreakRewards } from '../../services/streakService';

const router = Router();

// ── POST respond to challenge ──
router.post('/:id/respond', validateUuidParams('id'), validateBody(respondChallengeSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { photo_url, has_photo, response_time_ms, answer_index, answer_text } = req.body;

  // Submit the response (validates challenge, membership, duplicates).
  // has_photo carries the v2 client's signal that bytes will arrive via
  // /api/photos/relay separately — the response row goes in with no URL.
  // photo_url is kept only for v1 backwards compat during the cutover.
  let response, challenge;
  try {
    ({ response, challenge } = await submitResponse(
      id, req.userId!, photo_url || null, response_time_ms || null, answer_index ?? null, answer_text || null, has_photo
    ));
  } catch (err: unknown) {
    if (err instanceof ModerationError) {
      res.status(400).json({ error: err.message, moderation_labels: err.labels });
      return;
    }
    if (err instanceof Error && 'statusCode' in err) {
      const statusErr = err as Error & { statusCode: number };
      res.status(statusErr.statusCode).json({ error: statusErr.message });
      return;
    }
    throw err;
  }

  const c = challenge;

  // Notify the challenge trigger-er that someone responded
  if (c.triggered_by && c.triggered_by !== req.userId) {
    notifyUserOfResponse(c.triggered_by, req.userId!, c.group_id, id).catch((err: unknown) => {
      logger.error('Notify response error', { error: err instanceof Error ? err.message : String(err), challengeId: id });
    });
  }

  // Emit real-time event for the response
  emitToGroup(c.group_id, 'challenge:response', {
    challengeId: id,
    groupId: c.group_id,
    response,
  });

  // Social Obligation Loop: notify non-responders
  notifySocialObligation(id, c.group_id).catch((err: unknown) => {
    logger.error('Social obligation loop error', { error: err instanceof Error ? err.message : String(err), challengeId: id });
  });

  // Streak Shield Earning + Milestone Checks
  processStreakRewards(req.userId!, c.group_id).catch((err: unknown) => {
    logger.error('Streak enhancement error', { error: err instanceof Error ? err.message : String(err), challengeId: id, userId: req.userId });
  });

  // Check if all responded -> complete
  checkChallengeCompletion(id, c.group_id).catch((err: unknown) => {
    logger.error('Challenge completion check error', { error: err instanceof Error ? err.message : String(err), challengeId: id });
  });

  logger.info('Challenge response submitted', { challengeId: id, userId: req.userId });
  res.status(201).json(response);
}));

export default router;
