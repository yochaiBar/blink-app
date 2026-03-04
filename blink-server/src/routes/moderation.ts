import { Router, Response } from 'express';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validate';
import { createReportSchema, blockUserSchema } from '../utils/schemas';
import logger from '../utils/logger';

const router = Router();
router.use(authenticate);

// POST /api/moderation/report - Report content or user
router.post('/report', validateBody(createReportSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { reported_user_id, reported_content_id, content_type, reason, description } = req.body;

  // Can't report yourself
  if (reported_user_id === req.userId) {
    res.status(400).json({ error: 'Cannot report yourself' });
    return;
  }

  const result = await query(
    `INSERT INTO content_reports (reporter_id, reported_user_id, reported_content_id, content_type, reason, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [req.userId, reported_user_id || null, reported_content_id || null, content_type, reason, description || null]
  );

  logger.info('Content reported', { reportId: result.rows[0].id, reporterId: req.userId, contentType: content_type });
  res.status(201).json({ id: result.rows[0].id, message: 'Report submitted successfully. We will review it shortly.' });
}));

// POST /api/moderation/block - Block a user
router.post('/block', validateBody(blockUserSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { blocked_id } = req.body;

  if (blocked_id === req.userId) {
    res.status(400).json({ error: 'Cannot block yourself' });
    return;
  }

  // Verify user exists
  const userCheck = await query(`SELECT id FROM users WHERE id = $1`, [blocked_id]);
  if (userCheck.rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  await query(
    `INSERT INTO user_blocks (blocker_id, blocked_id)
     VALUES ($1, $2)
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    [req.userId, blocked_id]
  );

  logger.info('User blocked', { blockerId: req.userId, blockedId: blocked_id });
  res.status(201).json({ message: 'User blocked successfully' });
}));

// GET /api/moderation/blocks - List blocked users
router.get('/blocks', asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT ub.id, ub.blocked_id, u.display_name, u.avatar_url, ub.created_at
     FROM user_blocks ub
     JOIN users u ON u.id = ub.blocked_id
     WHERE ub.blocker_id = $1
     ORDER BY ub.created_at DESC`,
    [req.userId]
  );
  res.json(result.rows);
}));

// DELETE /api/moderation/blocks/:userId - Unblock a user
router.delete('/blocks/:userId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;

  const result = await query(
    `DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2 RETURNING id`,
    [req.userId, userId]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Block not found' });
    return;
  }

  logger.info('User unblocked', { blockerId: req.userId, unblockedId: userId });
  res.json({ message: 'User unblocked successfully' });
}));

export default router;
