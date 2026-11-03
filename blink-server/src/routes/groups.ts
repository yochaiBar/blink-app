import { Router, Response } from 'express';
import { query, withTransaction } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validate';
import { createGroupSchema, joinGroupSchema } from '../utils/schemas';
import logger from '../utils/logger';
import crypto from 'crypto';
import { createNotification } from '../utils/notifications';
import { emitToGroup, isUserOnline } from '../socket';
import { enqueueKeyshare, dispatchPendingKeysharesForUser } from '../services/keyshareHub';
import { sendPushToUser } from '../services/pushNotifications';
import { uuidParams } from '../middleware/params';
import { GroupRow, CountRow, UserDisplayNameRow } from '../types/db';
import { getGroupWithMembers, handleAdminLeave } from '../services/groupService';
import { requireMember } from '../services/membership';
import { audienceOf } from '../services/audience';
import { HttpError } from '../utils/httpError';
import { nextAutoChallengeAt } from '../jobs/dailyChallenge';
import { validateQuery, parsedQuery } from '../middleware/validate';
import { paginationQuerySchema, PaginationQuery } from '../utils/schemas';
import { listChallenges } from '../services/challengeReads';

// (Legacy server-side group encryption removed in Phase 6 — group keys
// now live exclusively on member devices and arrive via the courier
// handshake at join.)

const router = Router();
const MAX_FREE_GROUPS = 3;

function generateInviteCode(): string {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
}

router.use(authenticate);
uuidParams(router, 'id');

// POST /api/groups - Create a group
router.post(
  '/',
  validateBody(createGroupSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { name, icon, quiet_hours_start, quiet_hours_end, timezone } = req.body;
    const zone: string = timezone || 'UTC';

    // 3-group free tier limit
    const userGroups = await query<CountRow>(`SELECT COUNT(*) FROM group_members WHERE user_id = $1`, [req.userId]);
    if (parseInt(userGroups.rows[0].count) >= MAX_FREE_GROUPS) {
      res.status(403).json({ error: `Free tier limited to ${MAX_FREE_GROUPS} groups` });
      return;
    }

    const inviteCode = generateInviteCode();

    const newGroup = await withTransaction(async (client) => {
      const group = await client.query<GroupRow>(
        `INSERT INTO groups
           (name, icon, created_by, invite_code, quiet_hours_start, quiet_hours_end, timezone, next_auto_challenge_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          name,
          icon || '\u{1F465}',
          req.userId,
          inviteCode,
          quiet_hours_start || '22:00',
          quiet_hours_end || '08:00',
          zone,
          nextAutoChallengeAt(zone),
        ],
      );

      // Add creator as admin
      await client.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`, [
        group.rows[0].id,
        req.userId,
      ]);

      return group.rows[0];
    });

    // (Phase 6: no server-side key generation — creator's device generates
    // the group key locally via useGroups → newGroupKey + storeGroupKey.)

    logger.info('Group created', { groupId: newGroup.id, userId: req.userId });
    res.status(201).json(newGroup);
  }),
);

// GET /api/groups - List user's groups
router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await query(
      `SELECT g.*, gm.role,
       (SELECT COUNT(*)::int FROM group_members WHERE group_id = g.id) as member_count,
       EXISTS(
         SELECT 1 FROM challenges
         WHERE group_id = g.id AND status = 'active' AND expires_at > NOW()
       ) as has_active_challenge,
       (SELECT expires_at FROM challenges
        WHERE group_id = g.id AND status = 'active' AND expires_at > NOW()
        ORDER BY expires_at ASC LIMIT 1
       ) as challenge_expires_at
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = $1
     ORDER BY g.created_at DESC`,
      [req.userId],
    );
    res.json(result.rows);
  }),
);

// GET /api/groups/:id - Get group details + members + stats
router.get(
  '/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    await requireMember(req.userId!, { groupId: id });
    const { group, members } = await getGroupWithMembers(id);

    res.json({
      ...group,
      members,
    });
  }),
);

// POST /api/groups/join - Join via invite code
router.post(
  '/join',
  validateBody(joinGroupSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { invite_code, device_id: joinerDeviceId } = req.body as {
      invite_code: string;
      device_id?: string;
    };

    // 3-group free tier limit
    const userGroups = await query<CountRow>(`SELECT COUNT(*) FROM group_members WHERE user_id = $1`, [req.userId]);
    if (parseInt(userGroups.rows[0].count) >= MAX_FREE_GROUPS) {
      res.status(403).json({ error: `Free tier limited to ${MAX_FREE_GROUPS} groups` });
      return;
    }

    const group = await query<GroupRow>(`SELECT * FROM groups WHERE invite_code = $1`, [invite_code.toUpperCase()]);
    if (group.rows.length === 0) {
      res.status(404).json({ error: 'Invalid invite code' });
      return;
    }

    const g = group.rows[0];

    // Capacity check and insert under a lock on the group row, so concurrent
    // joins serialize and can never push the group past max_members.
    const outcome = await withTransaction(async (client) => {
      await client.query(`SELECT id FROM groups WHERE id = $1 FOR UPDATE`, [g.id]);
      const existing = await client.query(`SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`, [
        g.id,
        req.userId,
      ]);
      if (existing.rows.length > 0) return 'already_member' as const;
      const count = await client.query<CountRow>(`SELECT COUNT(*) FROM group_members WHERE group_id = $1`, [g.id]);
      if (parseInt(count.rows[0].count) >= g.max_members) return 'full' as const;
      await client.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`, [
        g.id,
        req.userId,
      ]);
      return 'joined' as const;
    });
    if (outcome === 'full') {
      // Same answer as an unknown code, so a full group can't be probed.
      res.status(404).json({ error: 'Invalid invite code' });
      return;
    }
    if (outcome === 'already_member') {
      res.json(g);
      return;
    }

    // Notify existing group members (except anyone blocked with the joiner)
    const joinerUser = await query<UserDisplayNameRow>(`SELECT display_name FROM public_users WHERE id = $1`, [
      req.userId,
    ]);
    const joinerName = joinerUser.rows[0]?.display_name || 'Someone';

    const audience = await audienceOf(g.id, req.userId!);
    const existingMembers = await query<{ user_id: string }>(
      `SELECT user_id FROM group_members WHERE group_id = $1 AND user_id != $2`,
      [g.id, req.userId],
    );
    for (const memberId of audience) {
      await createNotification(
        memberId,
        'group_joined',
        'New Member!',
        `${joinerName} joined ${g.name}`,
        g.id,
        req.userId,
      );
    }

    // Emit real-time event
    emitToGroup(g.id, 'group:member-joined', {
      groupId: g.id,
      userId: req.userId,
      displayName: joinerName,
    });

    // Fire-and-forget push notification to group creator
    if (g.created_by && audience.includes(g.created_by)) {
      sendPushToUser(g.created_by, 'New Member!', `${joinerName} joined ${g.name}`, {
        type: 'group_joined',
        groupId: g.id,
      }).catch(() => {});
    }

    // ── Enqueue the group-key courier handshake (Phase 4 of the E2E flow) ──
    // Only relevant when v2 client sends device_id AND the joiner isn't the
    // only member (a 1-member group has no one to courier from). The first
    // online existing member is invited to courier via dispatchPendingKeyshares
    // synchronously; if no one is online, the row waits in `pending` until
    // someone connects and the socket onUserConnect listener fires.
    if (joinerDeviceId && existingMembers.rows.length > 0) {
      try {
        await enqueueKeyshare({
          groupId: g.id,
          joinerUserId: req.userId!,
          joinerDeviceId,
        });
        // Try every online existing member — atomic claim inside dispatch
        // means only one will actually emit. Sequential await is fine; the
        // typical group size is tiny.
        for (const m of existingMembers.rows) {
          if (await isUserOnline(m.user_id)) {
            dispatchPendingKeysharesForUser(m.user_id).catch(() => undefined);
          }
        }
      } catch (err) {
        // Non-blocking — joiner still gets their group_members row. If the
        // enqueue failed, the joiner won't receive an envelope and Phase 5
        // UX will show "Waiting for a member to share access."
        logger.error('keyshare enqueue failed', {
          groupId: g.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('User joined group', { groupId: g.id, userId: req.userId });
    res.json(g);
  }),
);

// POST /api/groups/:id/leave - Leave a group
router.post(
  '/:id/leave',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    // Leaving a group you're not in answers 404 rather than 403.
    const membership = await requireMember(req.userId!, { groupId: id }).catch(() => {
      throw new HttpError(404, 'Not a member of this group');
    });

    // Admin hand-over and the membership delete commit together.
    const result = await withTransaction(async (client) => {
      if (membership.role === 'admin') {
        const handover = await handleAdminLeave(client, id, req.userId!);
        if (handover === 'deleted') return 'group_deleted' as const;
      }
      await client.query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, [id, req.userId]);
      return 'left' as const;
    });
    if (result === 'group_deleted') {
      res.json({ message: 'Left group. Group was deleted as you were the last member.' });
      return;
    }

    logger.info('User left group', { groupId: id, userId: req.userId });
    res.json({ message: 'Left group successfully' });
  }),
);

// DELETE /api/groups/:id - Delete a group (admin only)
router.delete(
  '/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    const membership = await requireMember(req.userId!, { groupId: id });
    if (membership.role !== 'admin') {
      throw new HttpError(403, 'Only group admins can delete a group');
    }

    const result = await query(`DELETE FROM groups WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    logger.info('Group deleted by admin', { groupId: id, userId: req.userId });
    res.json({ message: 'Group deleted successfully' });
  }),
);

// ── GET /api/groups/:id/challenges -- the group's challenges, newest first ──
// Cursor pagination: pass the last item's created_at as `before`.
router.get(
  '/:id/challenges',
  validateQuery(paginationQuerySchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { limit, before } = parsedQuery<PaginationQuery>(res);
    await requireMember(req.userId!, { groupId: id });

    const items = await listChallenges(
      `c.group_id = $3 AND ($4::timestamptz IS NULL OR c.created_at < $4::timestamptz)`,
      [id, before ?? null],
      req.userId!,
      limit,
    );
    res.json(items);
  }),
);

// ── GET /api/groups/:id/stats -- Group statistics (top trigger, longest streak, fastest responder) ──
router.get(
  '/:id/stats',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    await requireMember(req.userId!, { groupId: id });

    // Top trigger: user who triggered the most challenges in this group
    const topTriggerResult = await query(
      `SELECT c.created_by AS user_id,
            u.display_name,
            COUNT(*)::int AS count
     FROM challenges c
     JOIN public_users u ON u.id = c.created_by
     WHERE c.group_id = $1 AND c.created_by IS NOT NULL
     GROUP BY c.created_by, u.display_name
     ORDER BY count DESC
     LIMIT 1`,
      [id],
    );

    // Longest streak: member with the highest current_streak in this group
    const longestStreakResult = await query(
      `SELECT gm.user_id,
            u.display_name,
            gm.current_streak AS streak
     FROM group_members gm
     JOIN public_users u ON u.id = gm.user_id
     WHERE gm.group_id = $1
     ORDER BY gm.current_streak DESC
     LIMIT 1`,
      [id],
    );

    // Fastest responder: user with the lowest average response_time_ms
    const fastestResponderResult = await query(
      `SELECT cr.user_id,
            u.display_name,
            AVG(cr.response_time_ms)::int AS avg_ms
     FROM challenge_responses cr
     JOIN challenges c ON c.id = cr.challenge_id
     JOIN public_users u ON u.id = cr.user_id
     WHERE c.group_id = $1 AND cr.response_time_ms IS NOT NULL
     GROUP BY cr.user_id, u.display_name
     ORDER BY avg_ms ASC
     LIMIT 1`,
      [id],
    );

    // Total challenges in this group
    const totalChallengesResult = await query<CountRow>(
      `SELECT COUNT(*)::int AS count FROM challenges WHERE group_id = $1`,
      [id],
    );

    // Completion rate: challenges with status='completed' / total
    const completedChallengesResult = await query<CountRow>(
      `SELECT COUNT(*)::int AS count FROM challenges WHERE group_id = $1 AND status = 'completed'`,
      [id],
    );

    const totalChallenges = parseInt(totalChallengesResult.rows[0]?.count ?? '0');
    const completedChallenges = parseInt(completedChallengesResult.rows[0]?.count ?? '0');
    const completionRate = totalChallenges > 0 ? Math.round((completedChallenges / totalChallenges) * 100) / 100 : 0;

    const topTrigger = topTriggerResult.rows[0]
      ? {
          user_id: topTriggerResult.rows[0].user_id,
          display_name: topTriggerResult.rows[0].display_name,
          count: topTriggerResult.rows[0].count,
        }
      : null;

    const longestStreak = longestStreakResult.rows[0]
      ? {
          user_id: longestStreakResult.rows[0].user_id,
          display_name: longestStreakResult.rows[0].display_name,
          streak: longestStreakResult.rows[0].streak,
        }
      : null;

    const fastestResponder = fastestResponderResult.rows[0]
      ? {
          user_id: fastestResponderResult.rows[0].user_id,
          display_name: fastestResponderResult.rows[0].display_name,
          avg_ms: fastestResponderResult.rows[0].avg_ms,
        }
      : null;

    res.json({
      top_trigger: topTrigger,
      longest_streak: longestStreak,
      fastest_responder: fastestResponder,
      total_challenges: totalChallenges,
      completion_rate: completionRate,
    });
  }),
);

export default router;
