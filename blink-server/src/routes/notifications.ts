import { Router, Response } from 'express';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import logger from '../utils/logger';

const router = Router();

router.use(authenticate);

// GET /api/notifications — Get user's notifications
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT n.id, n.type, n.title, n.body, n.read,
            n.created_at as timestamp,
            n.group_id as "groupId",
            g.name as "groupName",
            u.avatar_url as "fromUserAvatar"
     FROM notifications n
     LEFT JOIN users u ON u.id = n.from_user_id
     LEFT JOIN groups g ON g.id = n.group_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC
     LIMIT 50`,
    [req.userId]
  );

  // Map server notification types to UI types
  const typeMap: Record<string, string> = {
    challenge_started: 'challenge',
    snap_received: 'reaction',
    group_joined: 'join',
    streak_milestone: 'streak',
    spotlight: 'spotlight',
  };

  const mapped = result.rows.map((row) => ({
    ...row,
    type: typeMap[row.type as string] || row.type,
  }));

  res.json(mapped);
}));

// PATCH /api/notifications/read — Mark all as read
router.patch('/read', asyncHandler(async (req: AuthRequest, res: Response) => {
  await query(
    `UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`,
    [req.userId]
  );

  logger.info('All notifications marked as read', { userId: req.userId });
  res.json({ message: 'All notifications marked as read' });
}));

// PATCH /api/notifications/:id/read — Mark single notification as read
router.patch('/:id/read', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const result = await query(
    `UPDATE notifications SET read = TRUE
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [id, req.userId]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }

  logger.info('Notification marked as read', { notificationId: id, userId: req.userId });
  res.json(result.rows[0]);
}));

export default router;
