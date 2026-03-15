import { Router, Response } from 'express';
import { query, withTransaction } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validate';
import { createGroupSchema, joinGroupSchema } from '../utils/schemas';
import logger from '../utils/logger';
import crypto from 'crypto';
import { createNotification } from '../utils/notifications';
import { emitToGroup } from '../socket';
import { sendPushToUser } from '../services/pushNotifications';
import { validateUuidParams } from '../middleware/validateParams';
import { GroupRow, CountRow, UserDisplayNameRow } from '../types/db';
import { verifyMembership, getGroupWithMembers, handleAdminLeave } from '../services/groupService';
import type { QueryResult } from 'pg';

/** Minimal query interface compatible with both PoolClient and the pool query helper */
interface TransactionQueryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, params?: unknown[]): Promise<QueryResult<any>>;
}

const router = Router();
const MAX_FREE_GROUPS = 3;

function generateInviteCode(): string {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
}

router.use(authenticate);

// POST /api/groups - Create a group
router.post('/', validateBody(createGroupSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, icon, category, quiet_hours_start, quiet_hours_end, skip_penalty_type, ai_personality } = req.body;

  // 3-group free tier limit
  const userGroups = await query<CountRow>(
    `SELECT COUNT(*) FROM group_members WHERE user_id = $1`,
    [req.userId]
  );
  if (parseInt(userGroups.rows[0].count) >= MAX_FREE_GROUPS) {
    res.status(403).json({ error: `Free tier limited to ${MAX_FREE_GROUPS} groups` });
    return;
  }

  const inviteCode = generateInviteCode();

  const createGroupQueries = async (q: TransactionQueryable) => {
    const group = await q.query(
      `INSERT INTO groups (name, icon, category, created_by, invite_code, quiet_hours_start, quiet_hours_end, skip_penalty_type, ai_personality)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        name,
        icon || '\u{1F465}',
        category || 'friends',
        req.userId,
        inviteCode,
        quiet_hours_start || '22:00',
        quiet_hours_end || '08:00',
        skip_penalty_type || 'wanted_poster',
        ai_personality || 'funny',
      ]
    );

    // Add creator as admin
    await q.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [group.rows[0].id, req.userId]
    );

    return group.rows[0] as GroupRow;
  };

  const newGroup = typeof withTransaction === 'function'
    ? await withTransaction(createGroupQueries)
    : await createGroupQueries({ query });

  logger.info('Group created', { groupId: newGroup.id, userId: req.userId });
  res.status(201).json(newGroup);
}));

// GET /api/groups - List user's groups
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
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
    [req.userId]
  );
  res.json(result.rows);
}));

// GET /api/groups/:id - Get group details + members + stats
router.get('/:id', validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  try {
    await verifyMembership(req.userId!, id);
    const { group, members, active_penalties } = await getGroupWithMembers(id);

    res.json({
      ...group,
      members,
      active_penalties,
    });
  } catch (err: unknown) {
    if (err instanceof Error && 'statusCode' in err) {
      const statusErr = err as Error & { statusCode: number };
      res.status(statusErr.statusCode).json({ error: statusErr.message });
      return;
    }
    throw err;
  }
}));

// POST /api/groups/join - Join via invite code
router.post('/join', validateBody(joinGroupSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { invite_code } = req.body;

  // 3-group free tier limit
  const userGroups = await query<CountRow>(
    `SELECT COUNT(*) FROM group_members WHERE user_id = $1`,
    [req.userId]
  );
  if (parseInt(userGroups.rows[0].count) >= MAX_FREE_GROUPS) {
    res.status(403).json({ error: `Free tier limited to ${MAX_FREE_GROUPS} groups` });
    return;
  }

  const group = await query<GroupRow>(
    `SELECT * FROM groups WHERE invite_code = $1`,
    [invite_code.toUpperCase()]
  );
  if (group.rows.length === 0) {
    res.status(404).json({ error: 'Invalid invite code' });
    return;
  }

  const g = group.rows[0];

  const count = await query<CountRow>(
    `SELECT COUNT(*) FROM group_members WHERE group_id = $1`,
    [g.id]
  );
  if (parseInt(count.rows[0].count) >= g.max_members) {
    res.status(404).json({ error: 'Invalid invite code' });
    return;
  }

  await query(
    `INSERT INTO group_members (group_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT (group_id, user_id) DO NOTHING`,
    [g.id, req.userId]
  );

  // Notify existing group members
  const joinerUser = await query<UserDisplayNameRow>(`SELECT display_name FROM users WHERE id = $1`, [req.userId]);
  const joinerName = joinerUser.rows[0]?.display_name || 'Someone';

  const existingMembers = await query(
    `SELECT user_id FROM group_members WHERE group_id = $1 AND user_id != $2`,
    [g.id, req.userId]
  );
  for (const member of existingMembers.rows) {
    await createNotification(
      member.user_id,
      'group_joined',
      'New Member!',
      `${joinerName} joined ${g.name}`,
      g.id,
      req.userId
    );
  }

  // Emit real-time event
  emitToGroup(g.id, 'group:member-joined', {
    groupId: g.id,
    userId: req.userId,
    displayName: joinerName,
  });

  // Fire-and-forget push notification to group creator
  if (g.created_by && g.created_by !== req.userId) {
    sendPushToUser(
      g.created_by,
      'New Member!',
      `${joinerName} joined ${g.name}`,
      { type: 'group_joined', groupId: g.id }
    ).catch(() => {});
  }

  logger.info('User joined group', { groupId: g.id, userId: req.userId });
  res.json(g);
}));

// POST /api/groups/:id/leave - Leave a group
router.post('/:id/leave', validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  let membership;
  try {
    membership = await verifyMembership(req.userId!, id);
  } catch {
    // verifyMembership throws 403, but leave returns 404 for non-members
    res.status(404).json({ error: 'Not a member of this group' });
    return;
  }

  if (membership.role === 'admin') {
    const result = await handleAdminLeave(id, req.userId!);
    if (result === 'deleted') {
      res.json({ message: 'Left group. Group was deleted as you were the last member.' });
      return;
    }
  }

  await query(
    `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [id, req.userId]
  );

  logger.info('User left group', { groupId: id, userId: req.userId });
  res.json({ message: 'Left group successfully' });
}));

// DELETE /api/groups/:id - Delete a group (admin only)
router.delete('/:id', validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  let membership;
  try {
    membership = await verifyMembership(req.userId!, id);
  } catch {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  if (membership.role !== 'admin') {
    res.status(403).json({ error: 'Only group admins can delete a group' });
    return;
  }

  const result = await query(`DELETE FROM groups WHERE id = $1 RETURNING id`, [id]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  logger.info('Group deleted by admin', { groupId: id, userId: req.userId });
  res.json({ message: 'Group deleted successfully' });
}));

// ── GET /api/groups/:id/streaks -- Group streak + member streaks + shields ──
router.get('/:id/streaks', validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  try {
    await verifyMembership(req.userId!, id);
  } catch (err: unknown) {
    if (err instanceof Error && 'statusCode' in err) {
      const statusErr = err as Error & { statusCode: number };
      res.status(statusErr.statusCode).json({ error: statusErr.message });
      return;
    }
    throw err;
  }

  // Get group streak info
  const groupResult = await query<Pick<GroupRow, 'group_streak' | 'longest_group_streak'>>(
    `SELECT group_streak, longest_group_streak FROM groups WHERE id = $1`,
    [id]
  );
  const groupStreak = groupResult.rows[0]?.group_streak || 0;
  const longestGroupStreak = groupResult.rows[0]?.longest_group_streak || 0;

  // Get all members with streaks
  const members = await query(
    `SELECT gm.user_id, COALESCE(u.display_name, u.phone_number) AS display_name, u.avatar_url, gm.current_streak as streak
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1
     ORDER BY gm.current_streak DESC`,
    [id]
  );

  // Get shields remaining per member
  const shields = await query(
    `SELECT user_id, COUNT(*)::int as shields_remaining
     FROM streak_shields
     WHERE group_id = $1 AND used_at IS NULL
     GROUP BY user_id`,
    [id]
  );
  const shieldsMap: Record<string, number> = {};
  for (const row of shields.rows) {
    shieldsMap[row.user_id] = row.shields_remaining;
  }

  // Get milestones per member
  const milestones = await query(
    `SELECT user_id, ARRAY_AGG(milestone ORDER BY milestone) as milestones
     FROM streak_milestones
     WHERE group_id = $1
     GROUP BY user_id`,
    [id]
  );
  const milestonesMap: Record<string, number[]> = {};
  for (const row of milestones.rows) {
    milestonesMap[row.user_id] = row.milestones;
  }

  res.json({
    groupStreak,
    longestGroupStreak,
    members: members.rows.map((m) => ({
      userId: m.user_id,
      displayName: m.display_name,
      avatarUrl: m.avatar_url,
      streak: m.streak,
      shieldsRemaining: shieldsMap[m.user_id] || 0,
      milestones: milestonesMap[m.user_id] || [],
    })),
  });
}));

export default router;
