import { Router, Response } from 'express';
import { query } from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../middleware/validate';
import { addReactionSchema } from '../../utils/schemas';
import logger from '../../utils/logger';
import { sendPushToUser } from '../../services/pushNotifications';
import { uuidParams } from '../../middleware/params';
import { requireVisibleResponse } from '../../services/membership';
import { ReactionRow, UserDisplayNameRow } from '../../types/db';

const router = Router();
uuidParams(router, 'responseId');

// ── POST /api/challenges/responses/:responseId/reactions — Add reaction ──
router.post(
  '/responses/:responseId/reactions',
  validateBody(addReactionSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { responseId } = req.params;
    const { emoji } = req.body;

    // Member of the group, and the response's author isn't blocked with us.
    const context = await requireVisibleResponse(req.userId!, responseId as string);

    const result = await query<ReactionRow>(
      `INSERT INTO reactions (response_id, user_id, emoji)
     VALUES ($1, $2, $3)
     ON CONFLICT (response_id, user_id, emoji) DO NOTHING
     RETURNING *`,
      [responseId, req.userId, emoji],
    );

    if (result.rows.length === 0) {
      res.status(409).json({ error: 'Reaction already exists' });
      return;
    }

    // Fire-and-forget push notification to the response owner
    const responseOwner = context.responseUserId;
    if (responseOwner && responseOwner !== req.userId) {
      const reactorUser = await query<UserDisplayNameRow>(`SELECT display_name FROM public_users WHERE id = $1`, [
        req.userId,
      ]);
      const reactorName = reactorUser.rows[0]?.display_name || 'Someone';
      sendPushToUser(responseOwner, 'New Reaction!', `${reactorName} reacted ${emoji} to your photo`, {
        type: 'reaction',
        responseId,
        groupId: context.groupId,
      }).catch(() => {});
    }

    logger.info('Reaction added', { responseId, userId: req.userId, emoji });
    res.status(201).json(result.rows[0]);
  }),
);

// ── DELETE /api/challenges/responses/:responseId/reactions/:emoji — Remove reaction ──
router.delete(
  '/responses/:responseId/reactions/:emoji',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { responseId, emoji } = req.params;

    const result = await query(
      `DELETE FROM reactions
     WHERE response_id = $1 AND user_id = $2 AND emoji = $3
     RETURNING *`,
      [responseId, req.userId, emoji],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Reaction not found' });
      return;
    }

    logger.info('Reaction removed', { responseId, userId: req.userId, emoji });
    res.json({ message: 'Reaction removed' });
  }),
);

export default router;
