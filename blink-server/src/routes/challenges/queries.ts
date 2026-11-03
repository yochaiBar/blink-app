import { Router, Response } from 'express';
import { query } from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateUuidParams } from '../../middleware/validateParams';
import { CHALLENGE_SELECT, CHALLENGE_SELECT_C, processSkipsForChallenge } from './shared';
import { GroupMemberRow, ChallengeRow, ChallengeResponseRow, CountRow } from '../../types/db';

/** Response row with user info from JOIN */
interface ResponseWithUserRow {
  id: string;
  challenge_id: string;
  user_id: string;
  has_photo: boolean;
  responded_at: Date;
  response_time_ms: number | null;
  display_name: string;
}

/** Reaction aggregate row */
interface ReactionAggregateRow {
  response_id: string;
  emoji: string;
  count: string;
  user_names?: string[];
}

/** User summary row used in progress/preview */
interface UserSummaryRow {
  user_id: string;
  display_name: string;
}

const router = Router();

// ── GET active challenge ──
router.get(
  '/groups/:groupId/challenges/active',
  validateUuidParams('groupId'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const groupId = req.params.groupId as string;

    const membership = await query<GroupMemberRow>(`SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`, [
      groupId,
      req.userId,
    ]);
    if (membership.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Auto-expire and process skips
    const expired = await query<Pick<ChallengeRow, 'id'>>(
      `SELECT id FROM challenges
     WHERE group_id = $1 AND status = 'active' AND expires_at < NOW()`,
      [groupId],
    );
    for (const e of expired.rows) {
      await processSkipsForChallenge(e.id, groupId);
    }
    await query(
      `UPDATE challenges SET status = 'expired'
     WHERE group_id = $1 AND status = 'active' AND expires_at < NOW()`,
      [groupId],
    );

    // Return active challenges OR completed/expired ones still within their countdown window
    const result = await query(
      `SELECT ${CHALLENGE_SELECT} FROM challenges
     WHERE group_id = $1
       AND (status = 'active' OR (status IN ('completed', 'expired') AND expires_at > NOW()))
     ORDER BY created_at DESC LIMIT 1`,
      [groupId],
    );

    if (result.rows.length === 0) {
      res.json(null);
      return;
    }

    const challenge = result.rows[0];

    const userResponse = await query<Pick<ChallengeResponseRow, 'id'>>(
      `SELECT id FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
      [challenge.id, req.userId],
    );

    res.json({
      ...challenge,
      user_has_responded: userResponse.rows.length > 0,
    });
  }),
);

// ── GET responses (can't peek until you play) ──
router.get(
  '/:id/responses',
  validateUuidParams('id'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    const userResponse = await query<Pick<ChallengeResponseRow, 'id'>>(
      `SELECT id FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
      [id, req.userId],
    );
    if (userResponse.rows.length === 0) {
      res.status(403).json({ error: "Can't peek until you play! Respond first." });
      return;
    }

    const responses = await query<ResponseWithUserRow>(
      `SELECT cr.*, COALESCE(u.display_name, u.phone_number) AS display_name
     FROM challenge_responses cr
     JOIN users u ON u.id = cr.user_id
     WHERE cr.challenge_id = $1
     ORDER BY cr.responded_at`,
      [id],
    );

    // Fetch reactions for all responses in this challenge
    const responseIds = responses.rows.map((r) => r.id);
    let reactionsMap: Record<string, { emoji: string; count: number; users: string[] }[]> = {};

    if (responseIds.length > 0) {
      const reactions = await query<ReactionAggregateRow>(
        `SELECT r.response_id, r.emoji, COUNT(*) as count,
              ARRAY_AGG(COALESCE(u.display_name, u.phone_number)) as user_names
       FROM reactions r
       JOIN users u ON u.id = r.user_id
       WHERE r.response_id = ANY($1)
       GROUP BY r.response_id, r.emoji
       ORDER BY count DESC`,
        [responseIds],
      );

      for (const row of reactions.rows) {
        if (!reactionsMap[row.response_id]) {
          reactionsMap[row.response_id] = [];
        }
        reactionsMap[row.response_id].push({
          emoji: row.emoji,
          count: parseInt(row.count),
          users: row.user_names || [],
        });
      }
    }

    const responsesWithReactions = responses.rows.map((r) => ({
      ...r,
      reactions: reactionsMap[r.id] || [],
    }));

    res.json(responsesWithReactions);
  }),
);

// ── GET /api/challenges/:id/reveal — Full reveal data for completed challenge ──
router.get(
  '/:id/reveal',
  validateUuidParams('id'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    // Verify challenge exists
    const challengeResult = await query(
      `SELECT c.*, g.name as group_name, g.icon as group_emoji
     FROM challenges c
     JOIN groups g ON g.id = c.group_id
     WHERE c.id = $1`,
      [id],
    );
    if (challengeResult.rows.length === 0) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }
    const c = challengeResult.rows[0];

    // Verify user is a group member
    const membership = await query<GroupMemberRow>(`SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`, [
      c.group_id,
      req.userId,
    ]);
    if (membership.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Can't peek gate — user must have responded
    const userResponse = await query<Pick<ChallengeResponseRow, 'id'>>(
      `SELECT id FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
      [id, req.userId],
    );
    if (userResponse.rows.length === 0) {
      res.status(403).json({ error: "Can't peek until you play! Respond first." });
      return;
    }

    // Fetch all responses with user info (only from current group members)
    const responses = await query<ResponseWithUserRow>(
      `SELECT cr.*, COALESCE(u.display_name, u.phone_number) AS display_name
     FROM challenge_responses cr
     JOIN users u ON u.id = cr.user_id
     JOIN group_members gm ON gm.group_id = $2 AND gm.user_id = cr.user_id
     WHERE cr.challenge_id = $1
     ORDER BY cr.responded_at ASC`,
      [id, c.group_id],
    );

    // Fetch reactions for all responses
    const responseIds = responses.rows.map((r) => r.id);
    let reactionsMap: Record<string, { emoji: string; count: number }[]> = {};

    if (responseIds.length > 0) {
      const reactions = await query(
        `SELECT r.response_id, r.emoji, COUNT(*)::int as count
       FROM reactions r
       WHERE r.response_id = ANY($1)
       GROUP BY r.response_id, r.emoji
       ORDER BY count DESC`,
        [responseIds],
      );

      for (const row of reactions.rows) {
        if (!reactionsMap[row.response_id]) {
          reactionsMap[row.response_id] = [];
        }
        reactionsMap[row.response_id].push({
          emoji: row.emoji,
          count: row.count,
        });
      }
    }

    // Total members in group
    const totalMembersResult = await query<CountRow>(
      `SELECT COUNT(*)::int as count FROM group_members WHERE group_id = $1`,
      [c.group_id],
    );
    const totalMembers = totalMembersResult.rows[0].count;

    // Check if all members have responded
    const totalResponsesResult = await query<CountRow>(
      `SELECT COUNT(*)::int as count FROM challenge_responses WHERE challenge_id = $1`,
      [id],
    );
    const allResponded = totalResponsesResult.rows[0].count >= totalMembers;

    // Format response
    const formattedResponses = responses.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      displayName: r.display_name,
      hasPhoto: r.has_photo,
      responseTimeMs: r.response_time_ms,
      respondedAt: r.responded_at,
      reactions: reactionsMap[r.id] || [],
    }));

    res.json({
      challenge: {
        id: c.id,
        prompt: c.prompt,
        groupName: c.group_name,
        groupEmoji: c.group_emoji,
        isAutoGenerated: c.is_auto_generated || false,
      },
      responses: formattedResponses,
      totalMembers,
      allResponded,
    });
  }),
);

// ── GET challenge history ──
router.get(
  '/groups/:groupId/challenges/history',
  validateUuidParams('groupId'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const groupId = req.params.groupId as string;

    const membership = await query<GroupMemberRow>(`SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`, [
      groupId,
      req.userId,
    ]);
    if (membership.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const result = await query(
      `SELECT ${CHALLENGE_SELECT_C},
       LEAST(
         (SELECT COUNT(*) FROM challenge_responses WHERE challenge_id = c.id),
         (SELECT COUNT(*)::int FROM group_members WHERE group_id = c.group_id)
       ) as response_count,
       (SELECT COUNT(*)::int FROM group_members WHERE group_id = c.group_id) as member_count,
       EXISTS(SELECT 1 FROM challenge_responses WHERE challenge_id = c.id AND user_id = $2) as user_responded
     FROM challenges c
     WHERE c.group_id = $1 AND c.status IN ('completed', 'expired')
     ORDER BY c.created_at DESC
     LIMIT $3`,
      [groupId, req.userId, limit],
    );

    res.json(result.rows);
  }),
);

// ── GET group photo timeline ──
router.get(
  '/groups/:groupId/photos',
  validateUuidParams('groupId'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const groupId = req.params.groupId as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

    const membership = await query(`SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`, [
      groupId,
      req.userId,
    ]);
    if (membership.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const result = await query(
      `SELECT cr.id, cr.challenge_id, cr.has_photo, cr.responded_at,
       c.prompt,
       COALESCE(u.display_name, u.phone_number) AS display_name
     FROM challenge_responses cr
     JOIN challenges c ON c.id = cr.challenge_id
     JOIN users u ON u.id = cr.user_id
     WHERE c.group_id = $1 AND cr.has_photo = TRUE
     ORDER BY cr.responded_at DESC
     LIMIT $2`,
      [groupId, limit],
    );

    res.json(result.rows);
  }),
);

// ── GET /api/challenges/:id/progress — Who responded (no can't-peek gate) ──
router.get(
  '/:id/progress',
  validateUuidParams('id'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    // Verify challenge exists
    const challenge = await query<Pick<ChallengeRow, 'group_id'>>(`SELECT group_id FROM challenges WHERE id = $1`, [
      id,
    ]);
    if (challenge.rows.length === 0) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }
    const groupId = challenge.rows[0].group_id;

    // Verify user is a group member
    const membership = await query<GroupMemberRow>(`SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`, [
      groupId,
      req.userId,
    ]);
    if (membership.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Get all group members
    const allMembers = await query<UserSummaryRow>(
      `SELECT gm.user_id, COALESCE(u.display_name, u.phone_number) AS display_name
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1`,
      [groupId],
    );

    // Get who responded
    const responded = await query<UserSummaryRow>(
      `SELECT cr.user_id, COALESCE(u.display_name, u.phone_number) AS display_name
     FROM challenge_responses cr
     JOIN users u ON u.id = cr.user_id
     WHERE cr.challenge_id = $1`,
      [id],
    );
    const respondedIds = new Set(responded.rows.map((r) => r.user_id));

    const pendingUsers = allMembers.rows
      .filter((m) => !respondedIds.has(m.user_id))
      .map((m) => ({ userId: m.user_id, displayName: m.display_name }));

    res.json({
      challengeId: id,
      respondedCount: responded.rows.length,
      totalMembers: allMembers.rows.length,
      respondedUsers: responded.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
      })),
      pendingUsers,
    });
  }),
);

// ── GET /api/challenges/:id/preview — Tease data without content ──
router.get(
  '/:id/preview',
  validateUuidParams('id'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    // Verify challenge exists
    const challenge = await query<Pick<ChallengeRow, 'group_id'>>(`SELECT group_id FROM challenges WHERE id = $1`, [
      id,
    ]);
    if (challenge.rows.length === 0) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }
    const groupId = challenge.rows[0].group_id;

    // Verify user is a group member
    const membership = await query<GroupMemberRow>(`SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`, [
      groupId,
      req.userId,
    ]);
    if (membership.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Total members
    const totalMembersResult = await query<CountRow>(
      `SELECT COUNT(*)::int as count FROM group_members WHERE group_id = $1`,
      [groupId],
    );
    const totalMembers = totalMembersResult.rows[0].count;

    // Who responded
    const responded = await query<UserSummaryRow>(
      `SELECT cr.user_id, COALESCE(u.display_name, u.phone_number) AS display_name
     FROM challenge_responses cr
     JOIN users u ON u.id = cr.user_id
     WHERE cr.challenge_id = $1`,
      [id],
    );

    // Total reactions across all responses in this challenge
    const reactionsResult = await query(
      `SELECT COUNT(*)::int as total_reactions
     FROM reactions r
     JOIN challenge_responses cr ON cr.id = r.response_id
     WHERE cr.challenge_id = $1`,
      [id],
    );
    const totalReactions = reactionsResult.rows[0]?.total_reactions || 0;

    // Top reaction emoji
    const topEmojiResult = await query(
      `SELECT r.emoji, COUNT(*) as cnt
     FROM reactions r
     JOIN challenge_responses cr ON cr.id = r.response_id
     WHERE cr.challenge_id = $1
     GROUP BY r.emoji
     ORDER BY cnt DESC
     LIMIT 1`,
      [id],
    );
    const topReactionEmoji = topEmojiResult.rows[0]?.emoji || null;

    res.json({
      challengeId: id,
      respondedCount: responded.rows.length,
      totalMembers,
      totalReactions,
      topReactionEmoji,
      respondedUsers: responded.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
      })),
    });
  }),
);

export default router;
