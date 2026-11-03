import type { PoolClient } from 'pg';
import { query } from '../config/database';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { GroupRow, GroupMemberRow } from '../types/db';

/**
 * Fetch a group by ID. Throws HttpError 404 if not found.
 */
export async function getGroup(groupId: string): Promise<GroupRow> {
  const group = await query<GroupRow>(`SELECT * FROM groups WHERE id = $1`, [groupId]);
  if (group.rows.length === 0) {
    throw new HttpError(404, 'Group not found');
  }
  return group.rows[0];
}

/**
 * Fetch a group along with its members.
 */
/** Member row returned from the group-with-members JOIN query */
interface GroupMemberDetailRow {
  user_id: string;
  display_name: string;
  role: string;
  joined_at: Date;
  streak: number;
  total_responses: number;
  total_challenges: number;
  participation_rate: number;
}

export async function getGroupWithMembers(groupId: string): Promise<{
  group: GroupRow;
  members: GroupMemberDetailRow[];
}> {
  const group = await getGroup(groupId);

  const members = await query<GroupMemberDetailRow>(
    `SELECT u.id as user_id, u.display_name, gm.role, gm.joined_at,
            gm.current_streak as streak, gm.total_responses, gm.total_challenges,
            CASE WHEN gm.total_challenges > 0
              THEN ROUND(gm.total_responses::numeric / gm.total_challenges * 100)::int
              ELSE 0
            END as participation_rate
     FROM group_members gm
     JOIN public_users u ON u.id = gm.user_id
     WHERE gm.group_id = $1
     ORDER BY gm.total_responses DESC`,
    [groupId],
  );

  return {
    group,
    members: members.rows,
  };
}

/**
 * Clear what a member leaving `groupId` (or every group, when omitted — on
 * account deletion) leaves in flight: their pending key requests, the joins
 * they were claimed to courier (freed for another holder), and photo
 * pickups to or from them. Runs on the caller's transaction, before the
 * membership row goes.
 */
export async function releaseMembership(client: PoolClient, userId: string, groupId?: string): Promise<void> {
  const params = [userId, groupId ?? null];
  await client.query(
    `DELETE FROM pending_joins WHERE joiner_user_id = $1 AND ($2::uuid IS NULL OR group_id = $2)`,
    params,
  );
  await client.query(
    `UPDATE pending_joins SET courier_user_id = NULL, lease_expires_at = NULL
      WHERE courier_user_id = $1 AND ($2::uuid IS NULL OR group_id = $2)`,
    params,
  );
  await client.query(
    `DELETE FROM pending_photo_pickups
      WHERE (recipient_user_id = $1 OR sender_user_id = $1) AND ($2::uuid IS NULL OR group_id = $2)`,
    params,
  );
}

/**
 * Hand the group over when an admin leaves (or deletes their account): if
 * nobody else is in it, delete the group; if no other admin remains,
 * promote the longest-standing member. Runs on the caller's transaction.
 */
export async function handleAdminLeave(
  client: PoolClient,
  groupId: string,
  userId: string,
): Promise<'deleted' | 'transferred' | 'no_action'> {
  const otherMembers = await client.query<Pick<GroupMemberRow, 'user_id' | 'role'>>(
    `SELECT user_id, role FROM group_members WHERE group_id = $1 AND user_id != $2`,
    [groupId, userId],
  );

  if (otherMembers.rows.length === 0) {
    // Last member -- delete the group entirely
    await client.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
    logger.info('Group deleted (last member left)', { groupId, userId });
    return 'deleted';
  }

  // Check if there are other admins
  const otherAdmins = otherMembers.rows.filter((m) => m.role === 'admin');
  if (otherAdmins.length === 0) {
    // Transfer admin to the longest-standing member
    const nextAdmin = await client.query<{ user_id: string }>(
      `SELECT user_id FROM group_members
       WHERE group_id = $1 AND user_id != $2
       ORDER BY joined_at ASC LIMIT 1`,
      [groupId, userId],
    );
    await client.query(`UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2`, [
      groupId,
      nextAdmin.rows[0].user_id,
    ]);
    logger.info('Admin role transferred', { groupId, newAdminId: nextAdmin.rows[0].user_id });
    return 'transferred';
  }

  return 'no_action';
}
