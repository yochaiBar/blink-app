import { Router, Response } from 'express';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import crypto from 'crypto';

const router = Router();
const MAX_FREE_GROUPS = 3;

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

router.use(authenticate);

// POST /api/groups - Create a group
router.post('/', async (req: AuthRequest, res: Response) => {
  const { name, icon, category, quiet_hours_start, quiet_hours_end, skip_penalty_type } = req.body;
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  // 3-group free tier limit
  const userGroups = await query(
    `SELECT COUNT(*) FROM group_members WHERE user_id = $1`,
    [req.userId]
  );
  if (parseInt(userGroups.rows[0].count) >= MAX_FREE_GROUPS) {
    res.status(403).json({ error: `Free tier limited to ${MAX_FREE_GROUPS} groups` });
    return;
  }

  const inviteCode = generateInviteCode();
  const group = await query(
    `INSERT INTO groups (name, icon, category, created_by, invite_code, quiet_hours_start, quiet_hours_end, skip_penalty_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      name,
      icon || '👥',
      category || 'friends',
      req.userId,
      inviteCode,
      quiet_hours_start || '22:00',
      quiet_hours_end || '08:00',
      skip_penalty_type || 'wanted_poster',
    ]
  );

  // Add creator as admin
  await query(
    `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`,
    [group.rows[0].id, req.userId]
  );

  res.status(201).json(group.rows[0]);
});

// GET /api/groups - List user's groups
router.get('/', async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT g.*, gm.role,
       (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = $1
     ORDER BY g.created_at DESC`,
    [req.userId]
  );
  res.json(result.rows);
});

// GET /api/groups/:id - Get group details + members + stats
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const membership = await query(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [id, req.userId]
  );
  if (membership.rows.length === 0) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  const group = await query(`SELECT * FROM groups WHERE id = $1`, [id]);
  if (group.rows.length === 0) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  const members = await query(
    `SELECT u.id, u.display_name, u.avatar_url, gm.role, gm.joined_at,
            gm.current_streak, gm.total_responses, gm.total_challenges,
            CASE WHEN gm.total_challenges > 0
              THEN ROUND(gm.total_responses::numeric / gm.total_challenges * 100)
              ELSE 0
            END as participation_rate
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1
     ORDER BY gm.total_responses DESC`,
    [id]
  );

  // Get active penalties for members
  const penalties = await query(
    `SELECT * FROM active_penalties
     WHERE group_id = $1 AND expires_at > NOW()`,
    [id]
  );

  res.json({
    ...group.rows[0],
    members: members.rows,
    active_penalties: penalties.rows,
  });
});

// POST /api/groups/join - Join via invite code
router.post('/join', async (req: AuthRequest, res: Response) => {
  const { invite_code } = req.body;
  if (!invite_code) {
    res.status(400).json({ error: 'invite_code is required' });
    return;
  }

  // 3-group free tier limit
  const userGroups = await query(
    `SELECT COUNT(*) FROM group_members WHERE user_id = $1`,
    [req.userId]
  );
  if (parseInt(userGroups.rows[0].count) >= MAX_FREE_GROUPS) {
    res.status(403).json({ error: `Free tier limited to ${MAX_FREE_GROUPS} groups` });
    return;
  }

  const group = await query(
    `SELECT * FROM groups WHERE invite_code = $1`,
    [invite_code.toUpperCase()]
  );
  if (group.rows.length === 0) {
    res.status(404).json({ error: 'Invalid invite code' });
    return;
  }

  const g = group.rows[0];

  const count = await query(
    `SELECT COUNT(*) FROM group_members WHERE group_id = $1`,
    [g.id]
  );
  if (parseInt(count.rows[0].count) >= g.max_members) {
    res.status(400).json({ error: 'Group is full' });
    return;
  }

  await query(
    `INSERT INTO group_members (group_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT (group_id, user_id) DO NOTHING`,
    [g.id, req.userId]
  );

  res.json(g);
});

export default router;
