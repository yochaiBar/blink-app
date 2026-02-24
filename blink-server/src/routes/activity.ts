import { Router, Response } from 'express';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import logger from '../utils/logger';

const router = Router();

router.use(authenticate);

// GET /api/activity — Recent activity across all user's groups
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const before = req.query.before as string | undefined;

  const params: any[] = [req.userId];
  let timestampFilter = '';

  if (before) {
    params.push(before);
    timestampFilter = `AND sub.timestamp < $2`;
  }

  const limitParam = params.length + 1;
  params.push(50);

  const result = await query(
    `SELECT * FROM (
      -- Photo/answer responses (snap)
      SELECT
        CASE WHEN cr.response_type = 'photo' THEN 'snap' ELSE 'quiz' END as type,
        u.display_name as "userName",
        u.avatar_url as "userAvatar",
        g.name as "groupName",
        g.id as "groupId",
        u.display_name || ' responded to a challenge' as message,
        cr.responded_at as timestamp,
        cr.photo_url as "imageUrl",
        cr.id as item_id
      FROM challenge_responses cr
      JOIN challenges c ON c.id = cr.challenge_id
      JOIN users u ON u.id = cr.user_id
      JOIN groups g ON g.id = c.group_id
      WHERE c.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
        AND cr.response_type != 'skip'

      UNION ALL

      -- Challenge triggered
      SELECT
        'challenge_triggered' as type,
        u.display_name as "userName",
        u.avatar_url as "userAvatar",
        g.name as "groupName",
        g.id as "groupId",
        u.display_name || ' triggered a ' || c.type || ' challenge' as message,
        c.triggered_at as timestamp,
        NULL as "imageUrl",
        c.id as item_id
      FROM challenges c
      JOIN users u ON u.id = c.triggered_by
      JOIN groups g ON g.id = c.group_id
      WHERE c.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)

      UNION ALL

      -- Group joins
      SELECT
        'join' as type,
        u.display_name as "userName",
        u.avatar_url as "userAvatar",
        g.name as "groupName",
        g.id as "groupId",
        u.display_name || ' joined ' || g.name as message,
        gm.joined_at as timestamp,
        NULL as "imageUrl",
        gm.id as item_id
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      JOIN groups g ON g.id = gm.group_id
      WHERE gm.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
    ) sub
    WHERE 1=1 ${timestampFilter}
    ORDER BY sub.timestamp DESC
    LIMIT $${limitParam}`,
    params
  );

  logger.debug('Activity feed fetched', { userId: req.userId, count: result.rows.length });
  res.json(result.rows);
}));

export default router;
