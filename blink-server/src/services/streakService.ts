import { query } from '../config/database';
import logger from '../utils/logger';
import { emitToGroup } from '../socket';
import { sendPushToGroup, sendPushToUser } from './pushNotifications';
import { generateSkipPenalty, AiPersonality } from './aiService';
import { GroupMemberRow, ChallengeResponseRow, GroupRow, CountRow, UserDisplayNameRow, StreakShieldRow } from '../types/db';

// ── Streak milestones that trigger celebrations ──
const MILESTONES = [3, 7, 14, 30, 50, 100];

// ── Streak shield interval (earned every N days) ──
const SHIELD_INTERVAL = 7;

/**
 * Check if the user's upcoming streak earns a streak shield,
 * and award it + send push notification if so.
 */
export async function checkAndAwardShield(
  userId: string,
  groupId: string,
  upcomingStreak: number
): Promise<void> {
  if (upcomingStreak > 0 && upcomingStreak % SHIELD_INTERVAL === 0) {
    await query(
      `INSERT INTO streak_shields (user_id, group_id) VALUES ($1, $2)`,
      [userId, groupId]
    );
    sendPushToUser(
      userId,
      'Streak Shield Earned!',
      "You earned a Streak Shield! It'll protect your streak if you miss a challenge.",
      { type: 'streak_shield_earned', groupId }
    ).catch(() => {});
    logger.info('Streak shield earned', { userId, groupId, streak: upcomingStreak });
  }
}

/**
 * Check if the user's upcoming streak hits a milestone.
 * If so, record it, notify the user and group.
 */
export async function checkMilestone(
  userId: string,
  groupId: string,
  upcomingStreak: number
): Promise<void> {
  if (!MILESTONES.includes(upcomingStreak)) return;

  await query(
    `INSERT INTO streak_milestones (user_id, group_id, milestone) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [userId, groupId, upcomingStreak]
  );

  const userName = await query(`SELECT COALESCE(display_name, phone_number) AS display_name FROM users WHERE id = $1`, [userId]);
  const displayName = userName.rows[0]?.display_name || 'Someone';

  sendPushToUser(
    userId,
    'Streak Milestone!',
    `Amazing! You hit a ${upcomingStreak}-day streak!`,
    { type: 'streak_milestone', groupId, milestone: upcomingStreak }
  ).catch(() => {});

  // Notify the group
  sendPushToGroup(
    groupId,
    'Streak Milestone!',
    `${displayName} just hit a ${upcomingStreak}-day streak! \u{1F525}`,
    { type: 'streak_milestone', groupId, userId, milestone: upcomingStreak },
    userId
  ).catch(() => {});

  emitToGroup(groupId, 'streak:milestone', {
    userId,
    displayName,
    milestone: upcomingStreak,
    groupId,
  });
}

/**
 * Process streak shields and milestone checks for a responding user.
 * Called when a user submits a challenge response.
 */
export async function processStreakRewards(
  userId: string,
  groupId: string
): Promise<void> {
  const streakResult = await query(
    `SELECT current_streak FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  const currentStreak = streakResult.rows[0]?.current_streak || 0;
  const upcomingStreak = currentStreak + 1;

  await checkAndAwardShield(userId, groupId, upcomingStreak);
  await checkMilestone(userId, groupId, upcomingStreak);
}

/**
 * Process skip penalties when a challenge expires or completes.
 * Handles: incrementing stats, streak logic, shield usage, penalties, group streak.
 */
export async function processSkipsForChallenge(challengeId: string, groupId: string): Promise<void> {
  // Get all group members
  const members = await query<Pick<GroupMemberRow, 'user_id'>>(
    `SELECT user_id FROM group_members WHERE group_id = $1`,
    [groupId]
  );

  // Get who responded (non-skip)
  const responded = await query<Pick<ChallengeResponseRow, 'user_id'>>(
    `SELECT user_id FROM challenge_responses WHERE challenge_id = $1 AND response_type != 'skip'`,
    [challengeId]
  );
  const respondedIds = new Set(responded.rows.map((r) => r.user_id));

  // Get group penalty type
  const group = await query<Pick<GroupRow, 'skip_penalty_type'>>(`SELECT skip_penalty_type FROM groups WHERE id = $1`, [groupId]);
  const penaltyType = group.rows[0]?.skip_penalty_type || 'wanted_poster';

  // Increment total_challenges for all members
  await query(
    `UPDATE group_members SET total_challenges = total_challenges + 1 WHERE group_id = $1`,
    [groupId]
  );

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
        [groupId, member.user_id]
      );
    } else {
      anyoneSkipped = true;
      if (!firstSkipperId) firstSkipperId = member.user_id;

      // Skipped: insert skip response
      await query(
        `INSERT INTO challenge_responses (challenge_id, user_id, response_type)
         VALUES ($1, $2, 'skip')
         ON CONFLICT (challenge_id, user_id) DO NOTHING`,
        [challengeId, member.user_id]
      );

      // Streak Shield: check before resetting streak
      const currentStreakResult = await query<Pick<GroupMemberRow, 'current_streak'>>(
        `SELECT current_streak FROM group_members WHERE group_id = $1 AND user_id = $2`,
        [groupId, member.user_id]
      );
      const currentStreak = currentStreakResult.rows[0]?.current_streak || 0;

      const shield = await query<Pick<StreakShieldRow, 'id'>>(
        `SELECT id FROM streak_shields WHERE user_id = $1 AND group_id = $2 AND used_at IS NULL ORDER BY earned_at LIMIT 1`,
        [member.user_id, groupId]
      );

      if (shield.rows.length > 0 && currentStreak > 0) {
        // Use the shield instead of resetting
        await query(
          `UPDATE streak_shields SET used_at = NOW(), used_for_challenge_id = $1 WHERE id = $2`,
          [challengeId, shield.rows[0].id]
        );

        // Count remaining shields
        const remainingShields = await query<CountRow>(
          `SELECT COUNT(*) FROM streak_shields WHERE user_id = $1 AND group_id = $2 AND used_at IS NULL`,
          [member.user_id, groupId]
        );
        const remaining = parseInt(remainingShields.rows[0].count);

        // Fire-and-forget push about shield usage
        sendPushToUser(
          member.user_id,
          'Streak Shield Activated!',
          `Your streak shield saved your ${currentStreak}-day streak! (${remaining} shield${remaining !== 1 ? 's' : ''} remaining)`,
          { type: 'streak_shield_used', groupId, challengeId }
        ).catch(() => {});

        logger.info('Streak shield used', { userId: member.user_id, groupId, challengeId, streak: currentStreak });
      } else {
        // No shield: reset streak
        await query(
          `UPDATE group_members SET current_streak = 0
           WHERE group_id = $1 AND user_id = $2`,
          [groupId, member.user_id]
        );
      }

      // Apply penalty if not 'none'
      if (penaltyType !== 'none') {
        const SILLY_AVATARS = ['\u{1F921}', '\u{1F438}', '\u{1F4A9}', '\u{1F47B}', '\u{1F916}', '\u{1F47D}', '\u{1F984}', '\u{1F414}'];

        let penaltyData: Record<string, unknown>;
        if (penaltyType === 'avatar_change') {
          penaltyData = { silly_avatar: SILLY_AVATARS[Math.floor(Math.random() * SILLY_AVATARS.length)] };
        } else {
          // Use AI to generate penalty text (falls back to hardcoded internally)
          try {
            const groupPersonalityResult = await query<Pick<GroupRow, 'ai_personality'>>(`SELECT ai_personality FROM groups WHERE id = $1`, [groupId]);
            const personality: AiPersonality = groupPersonalityResult.rows[0]?.ai_personality as AiPersonality || 'funny';
            const userNameResult = await query<UserDisplayNameRow>(`SELECT COALESCE(display_name, phone_number) AS display_name FROM users WHERE id = $1`, [member.user_id]);
            const userName = userNameResult.rows[0]?.display_name || 'Someone';
            const validPenaltyType = penaltyType as 'wanted_poster' | 'avatar_change' | 'servant';
            const aiPenalty = await generateSkipPenalty(userName, validPenaltyType, personality);
            penaltyData = { text: aiPenalty.text };
          } catch {
            // Hardcoded fallback if AI call itself throws
            penaltyData = penaltyType === 'wanted_poster'
              ? { text: 'WANTED: Last seen dodging group challenges' }
              : { text: `${member.user_id} is the group's servant today! Send them tasks.` };
          }
        }

        await query(
          `INSERT INTO active_penalties (group_id, user_id, penalty_type, penalty_data, expires_at)
           VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')`,
          [groupId, member.user_id, penaltyType, JSON.stringify(penaltyData)]
        );
      }
    }
  }

  // Group Streak: update based on whether everyone responded
  if (!anyoneSkipped && members.rows.length > 0) {
    await query(
      `UPDATE groups SET group_streak = group_streak + 1, longest_group_streak = GREATEST(longest_group_streak, group_streak + 1) WHERE id = $1`,
      [groupId]
    );
    emitToGroup(groupId, 'group:streak_update', { groupId, groupStreak: null, brokenBy: null });
    // Fetch updated value for socket event
    const updatedGroup = await query<Pick<GroupRow, 'group_streak'>>(`SELECT group_streak FROM groups WHERE id = $1`, [groupId]);
    emitToGroup(groupId, 'group:streak_update', { groupId, groupStreak: updatedGroup.rows[0]?.group_streak || 0, brokenBy: null });
  } else if (anyoneSkipped) {
    // Get current group streak before resetting (for notification)
    const groupStreakResult = await query<Pick<GroupRow, 'group_streak'>>(`SELECT group_streak FROM groups WHERE id = $1`, [groupId]);
    const brokenStreak = groupStreakResult.rows[0]?.group_streak || 0;

    await query(`UPDATE groups SET group_streak = 0 WHERE id = $1`, [groupId]);
    emitToGroup(groupId, 'group:streak_update', { groupId, groupStreak: 0, brokenBy: firstSkipperId });

    if (brokenStreak > 0 && firstSkipperId) {
      const skipperName = await query<UserDisplayNameRow>(`SELECT COALESCE(display_name, phone_number) AS display_name FROM users WHERE id = $1`, [firstSkipperId]);
      const name = skipperName.rows[0]?.display_name || 'Someone';
      sendPushToGroup(
        groupId,
        'Group Streak Broken!',
        `Group streak broken at ${brokenStreak} days! ${name} missed the challenge.`,
        { type: 'group_streak_broken', groupId, brokenStreak }
      ).catch(() => {});
    }
  }
}
