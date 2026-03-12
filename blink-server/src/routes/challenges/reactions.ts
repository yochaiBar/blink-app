import { Router, Response } from 'express';
import { query } from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../middleware/validate';
import { addReactionSchema } from '../../utils/schemas';
import logger from '../../utils/logger';
import { sendPushToUser } from '../../services/pushNotifications';
import { validateUuidParams } from '../../middleware/validateParams';

const router = Router();

// ── POST /api/challenges/responses/:responseId/reactions — Add reaction ──
router.post('/responses/:responseId/reactions', validateUuidParams('responseId'), validateBody(addReactionSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
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
    const reactorUser = await query(`SELECT COALESCE(display_name, phone_number) AS display_name FROM users WHERE id = $1`, [req.userId]);
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
