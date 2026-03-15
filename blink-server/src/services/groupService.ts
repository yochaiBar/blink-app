import { query } from '../config/database';
import logger from '../utils/logger';
import { GroupRow, GroupMemberRow } from '../types/db';

/**
 * Verify that a user is a member of a group.
 * Returns the membership row. Throws with statusCode if not a member.
 */
export async function verifyMembership(
  userId: string,
  groupId: string
): Promise<GroupMemberRow> {
  const membership = await query<GroupMemberRow>(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  if (membership.rows.length === 0) {
    throw Object.assign(new Error('Not a member of this group'), { statusCode: 403 });
  }
  return membership.rows[0];
}

/**
 * Fetch a group by ID. Throws with statusCode 404 if not found.
 */
export async function getGroup(groupId: string): Promise<GroupRow> {
  const group = await query<GroupRow>(`SELECT * FROM groups WHERE id = $1`, [groupId]);
  if (group.rows.length === 0) {
    throw Object.assign(new Error('Group not found'), { statusCode: 404 });
  }
  return group.rows[0];
}

/**
 * Fetch a group along with its members and active penalties.
 */
/** Member row returned from the group-with-members JOIN query */
interface GroupMemberDetailRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  joined_at: Date;
  streak: number;
  total_responses: number;
  total_challenges: number;
  participation_rate: number;
}

/** Active penalty row shape */
interface ActivePenaltyDetailRow {
  id: string;
  group_id: string;
  user_id: string;
  penalty_type: string;
  penalty_data: unknown;
  expires_at: Date;
  created_at: Date;
}

export async function getGroupWithMembers(groupId: string): Promise<{
  group: GroupRow;
  members: GroupMemberDetailRow[];
  active_penalties: ActivePenaltyDetailRow[];
}> {
  const group = await getGroup(groupId);

  const members = await query<GroupMemberDetailRow>(
    `SELECT u.id as user_id, COALESCE(u.display_name, u.phone_number) AS display_name, u.avatar_url, gm.role, gm.joined_at,
            gm.current_streak as streak, gm.total_responses, gm.total_challenges,
            CASE WHEN gm.total_challenges > 0
              THEN ROUND(gm.total_responses::numeric / gm.total_challenges * 100)::int
              ELSE 0
            END as participation_rate
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1
     ORDER BY gm.total_responses DESC`,
    [groupId]
  );

  const penalties = await query<ActivePenaltyDetailRow>(
    `SELECT * FROM active_penalties
     WHERE group_id = $1 AND expires_at > NOW()`,
    [groupId]
  );

  return {
    group,
    members: members.rows,
    active_penalties: penalties.rows,
  };
}

/**
 * Transfer admin role when the current admin leaves a group.
 * If no other admins exist, promotes the longest-standing member.
 * If no other members exist, deletes the group.
 * Returns 'deleted' if the group was deleted, 'transferred' if admin was transferred,
 * or 'no_action' if there are other admins.
 */
export async function handleAdminLeave(
  groupId: string,
  userId: string
): Promise<'deleted' | 'transferred' | 'no_action'> {
  const otherMembers = await query<Pick<GroupMemberRow, 'user_id' | 'role'>>(
    `SELECT user_id, role FROM group_members WHERE group_id = $1 AND user_id != $2`,
    [groupId, userId]
  );

  if (otherMembers.rows.length === 0) {
    // Last member -- delete the group entirely
    await query(`DELETE FROM groups WHERE id = $1`, [groupId]);
    logger.info('Group deleted (last member left)', { groupId, userId });
    return 'deleted';
  }

  // Check if there are other admins
  const otherAdmins = otherMembers.rows.filter((m) => m.role === 'admin');
  if (otherAdmins.length === 0) {
    // Transfer admin to the longest-standing member
    const nextAdmin = await query(
      `SELECT user_id FROM group_members
       WHERE group_id = $1 AND user_id != $2
       ORDER BY joined_at ASC LIMIT 1`,
      [groupId, userId]
    );
    await query(
      `UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2`,
      [groupId, nextAdmin.rows[0].user_id]
    );
    logger.info('Admin role transferred', { groupId, newAdminId: nextAdmin.rows[0].user_id });
    return 'transferred';
  }

  return 'no_action';
}
