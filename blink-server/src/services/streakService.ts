import { query } from '../config/database';
import { emitToGroup } from '../socket';
import { sendPushToGroup, sendPushToUser } from './pushNotifications';
import { GroupMemberRow, ChallengeResponseRow, GroupRow, UserDisplayNameRow } from '../types/db';

// ── Streak milestones that trigger celebrations ──
const MILESTONES = [3, 7, 14, 30, 50, 100];

/**
 * Check if the user's upcoming streak hits a milestone and, if so, notify
 * the user and the group. (Not persisted; Stage 2c moves milestones into
 * challenge finalization.)
 */
export async function checkMilestone(userId: string, groupId: string, upcomingStreak: number): Promise<void> {
  if (!MILESTONES.includes(upcomingStreak)) return;

  const userName = await query(`SELECT COALESCE(display_name, phone_number) AS display_name FROM users WHERE id = $1`, [
    userId,
  ]);
  const displayName = userName.rows[0]?.display_name || 'Someone';

  sendPushToUser(userId, 'Streak Milestone!', `Amazing! You hit a ${upcomingStreak}-day streak!`, {
    type: 'streak_milestone',
    groupId,
    milestone: upcomingStreak,
  }).catch(() => {});

  // Notify the group
  sendPushToGroup(
    groupId,
    'Streak Milestone!',
    `${displayName} just hit a ${upcomingStreak}-day streak! \u{1F525}`,
    { type: 'streak_milestone', groupId, userId, milestone: upcomingStreak },
    userId,
  ).catch(() => {});

  emitToGroup(groupId, 'streak:milestone', {
    userId,
    displayName,
    milestone: upcomingStreak,
    groupId,
  });
}

/**
 * Milestone check for a responding user.
 * Called when a user submits a challenge response.
 */
export async function processStreakRewards(userId: string, groupId: string): Promise<void> {
  const streakResult = await query(`SELECT current_streak FROM group_members WHERE group_id = $1 AND user_id = $2`, [
    groupId,
    userId,
  ]);
  const currentStreak = streakResult.rows[0]?.current_streak || 0;

  await checkMilestone(userId, groupId, currentStreak + 1);
}

/**
 * Settle member stats when a challenge expires or completes: every member's
 * total_challenges goes up, responders extend their streak, everyone who
 * has no response row loses theirs, and the group streak moves accordingly.
 */
export async function processSkipsForChallenge(challengeId: string, groupId: string): Promise<void> {
  // Get all group members
  const members = await query<Pick<GroupMemberRow, 'user_id'>>(
    `SELECT user_id FROM group_members WHERE group_id = $1`,
    [groupId],
  );

  // Get who responded
  const responded = await query<Pick<ChallengeResponseRow, 'user_id'>>(
    `SELECT user_id FROM challenge_responses WHERE challenge_id = $1`,
    [challengeId],
  );
  const respondedIds = new Set(responded.rows.map((r) => r.user_id));

  // Increment total_challenges for all members
  await query(`UPDATE group_members SET total_challenges = total_challenges + 1 WHERE group_id = $1`, [groupId]);

  let anyoneSkipped = false;
  let firstSkipperId: string | null = null;

  for (const member of members.rows) {
    if (respondedIds.has(member.user_id)) {
      // Responded: increment stats and streak
      await query(
        `UPDATE group_members
         SET total_responses = total_responses + 1,
             current_streak = current_streak + 1
         WHERE group_id = $1 AND user_id = $2`,
        [groupId, member.user_id],
      );
    } else {
      anyoneSkipped = true;
      if (!firstSkipperId) firstSkipperId = member.user_id;

      // Skipped: reset streak
      await query(
        `UPDATE group_members SET current_streak = 0
         WHERE group_id = $1 AND user_id = $2`,
        [groupId, member.user_id],
      );
    }
  }

  // Group Streak: update based on whether everyone responded
  if (!anyoneSkipped && members.rows.length > 0) {
    await query(
      `UPDATE groups SET group_streak = group_streak + 1, longest_group_streak = GREATEST(longest_group_streak, group_streak + 1) WHERE id = $1`,
      [groupId],
    );
    emitToGroup(groupId, 'group:streak_update', { groupId, groupStreak: null, brokenBy: null });
    // Fetch updated value for socket event
    const updatedGroup = await query<Pick<GroupRow, 'group_streak'>>(`SELECT group_streak FROM groups WHERE id = $1`, [
      groupId,
    ]);
    emitToGroup(groupId, 'group:streak_update', {
      groupId,
      groupStreak: updatedGroup.rows[0]?.group_streak || 0,
      brokenBy: null,
    });
  } else if (anyoneSkipped) {
    // Get current group streak before resetting (for notification)
    const groupStreakResult = await query<Pick<GroupRow, 'group_streak'>>(
      `SELECT group_streak FROM groups WHERE id = $1`,
      [groupId],
    );
    const brokenStreak = groupStreakResult.rows[0]?.group_streak || 0;

    await query(`UPDATE groups SET group_streak = 0 WHERE id = $1`, [groupId]);
    emitToGroup(groupId, 'group:streak_update', { groupId, groupStreak: 0, brokenBy: firstSkipperId });

    if (brokenStreak > 0 && firstSkipperId) {
      const skipperName = await query<UserDisplayNameRow>(
        `SELECT COALESCE(display_name, phone_number) AS display_name FROM users WHERE id = $1`,
        [firstSkipperId],
      );
      const name = skipperName.rows[0]?.display_name || 'Someone';
      sendPushToGroup(
        groupId,
        'Group Streak Broken!',
        `Group streak broken at ${brokenStreak} days! ${name} missed the challenge.`,
        { type: 'group_streak_broken', groupId, brokenStreak },
      ).catch(() => {});
    }
  }
}
