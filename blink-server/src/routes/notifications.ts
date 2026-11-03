import { Router, Response } from 'express';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import logger from '../utils/logger';

const router = Router();

router.use(authenticate);

// GET /api/notifications — Get user's notifications
router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await query(
      `SELECT n.id, n.type, n.title, n.body, n.read,
            n.created_at as timestamp,
            n.group_id as "groupId",
            g.name as "groupName"
     FROM notifications n
     LEFT JOIN groups g ON g.id = n.group_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC
     LIMIT 50`,
      [req.userId],
    );

    // Map server notification types to UI types
    const typeMap: Record<string, string> = {
      challenge_started: 'challenge',
      snap_received: 'reaction',
      group_joined: 'join',
      streak_milestone: 'streak',
    };

    const mapped = result.rows.map((row) => ({
      ...row,
      type: typeMap[row.type as string] || row.type,
    }));

    res.json(mapped);
  }),
);

// PATCH /api/notifications/read — Mark all as read
router.patch(
  '/read',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await query(`UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`, [req.userId]);

    logger.info('All notifications marked as read', { userId: req.userId });
    res.json({ message: 'All notifications marked as read' });
  }),
);

export default router;
