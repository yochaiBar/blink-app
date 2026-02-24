import { Router, Response } from 'express';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import logger from '../utils/logger';

const router = Router();

router.use(authenticate);

const SUPERLATIVES = [
  "Most likely to answer in pajamas",
  "Quickest thumbs in the group",
  "The one who never misses a challenge",
  "Most likely to snap with food in frame",
  "Group's biggest night owl",
  "The selfie champion",
  "Most likely to respond at the last second",
  "The group's moral support",
  "Fastest blinker alive",
  "Most likely to start a challenge at 8:01am",
];

// GET /api/groups/:groupId/spotlight — Get or generate today's spotlight
router.get('/:groupId/spotlight', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { groupId } = req.params;

  const membership = await query(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, req.userId]
  );
  if (membership.rows.length === 0) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  // Check if spotlight exists for today
  const existing = await query(
    `SELECT ds.*, u.display_name, u.avatar_url
     FROM daily_spotlights ds
     JOIN users u ON u.id = ds.featured_user_id
     WHERE ds.group_id = $1 AND ds.date = CURRENT_DATE`,
    [groupId]
  );

  if (existing.rows.length > 0) {
    res.json(existing.rows[0]);
    return;
  }

  // Generate a new spotlight — pick member not recently featured
  const featured = await query(
    `SELECT gm.user_id, u.display_name, u.avatar_url,
            gm.current_streak, gm.total_responses, gm.total_challenges
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1
       AND gm.user_id NOT IN (
         SELECT featured_user_id FROM daily_spotlights
         WHERE group_id = $1
         ORDER BY date DESC
         LIMIT (SELECT COUNT(*) - 1 FROM group_members WHERE group_id = $1)
       )
     ORDER BY RANDOM()
     LIMIT 1`,
    [groupId]
  );

  if (featured.rows.length === 0) {
    // All members have been featured recently, just pick random
    const fallback = await query(
      `SELECT gm.user_id, u.display_name, u.avatar_url,
              gm.current_streak, gm.total_responses, gm.total_challenges
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY RANDOM() LIMIT 1`,
      [groupId]
    );
    if (fallback.rows.length === 0) {
      res.json(null);
      return;
    }
    featured.rows = fallback.rows;
  }

  const member = featured.rows[0];
  const superlative = SUPERLATIVES[Math.floor(Math.random() * SUPERLATIVES.length)];
  const participationRate = member.total_challenges > 0
    ? Math.round((member.total_responses / member.total_challenges) * 100)
    : 0;

  const statsJson = {
    streak: member.current_streak,
    total_responses: member.total_responses,
    participation_rate: participationRate,
    fun_fact: participationRate >= 80
      ? `Answered ${participationRate}% of all challenges. Legend.`
      : participationRate >= 50
      ? `Shows up more than half the time. Respectable.`
      : `A mysterious figure. Only appears ${participationRate}% of the time.`,
  };

  const spotlight = await query(
    `INSERT INTO daily_spotlights (group_id, featured_user_id, superlative, stats_json)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [groupId, member.user_id, superlative, JSON.stringify(statsJson)]
  );

  logger.info('Daily spotlight generated', { groupId, featuredUserId: member.user_id });
  res.json({
    ...spotlight.rows[0],
    display_name: member.display_name,
    avatar_url: member.avatar_url,
  });
}));

export default router;
