import { query } from '../../config/database';
import logger from '../../utils/logger';
import { emitToGroup } from '../../socket';
import { sendPushToGroup, sendPushToUser } from '../../services/pushNotifications';
import { generateSkipPenalty, AiPersonality } from '../../services/aiService';

// Column aliases to map DB schema names to client-expected field names.
// The DB uses triggered_by/triggered_at/prompt_text/options_json,
// but the client ApiChallenge type expects created_by/created_at/prompt/options.
export const CHALLENGE_SELECT = `
  id, group_id, type,
  prompt_text as prompt,
  options_json as options,
  triggered_by as created_by,
  triggered_at as created_at,
  expires_at, status, countdown_seconds
`;

export const QUIZ_PRESETS = {
  food: [
    { prompt: "What did you eat for lunch today?", options: ["Something healthy (sure...)", "Leftovers from 3 days ago", "Snacks count as a meal", "I forgot to eat"] },
    { prompt: "What's your go-to midnight snack?", options: ["Cereal at 2am like a champ", "Whatever's in the fridge", "I order delivery at midnight", "I sleep like a normal person"] },
    { prompt: "How would you describe your cooking skills?", options: ["Gordon Ramsay vibes", "I can boil water", "Microwave master", "Does cereal count?"] },
  ],
  most_likely: [
    { prompt: "Who in this group is most likely to fall asleep first at a sleepover?", options: [] },
    { prompt: "Who is most likely to accidentally send a text to the wrong person?", options: [] },
    { prompt: "Who is most likely to show up late to their own birthday?", options: [] },
    { prompt: "Who is most likely to cry during a movie?", options: [] },
    { prompt: "Who is most likely to survive a zombie apocalypse?", options: [] },
  ],
  rate_day: [
    { prompt: "Rate your day so far", options: ["1-3: Dumpster fire", "4-5: Meh", "6-7: Pretty decent", "8-10: Living my best life"] },
    { prompt: "How's your energy level right now?", options: ["Running on fumes", "Need coffee IV drip", "Surprisingly alive", "Unstoppable"] },
    { prompt: "How social are you feeling today?", options: ["Don't talk to me", "Small talk only", "Down to hang", "LET'S GO OUT"] },
  ],
};

export function getRandomQuiz(type: 'food' | 'most_likely' | 'rate_day') {
  const pool = QUIZ_PRESETS[type];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Helper: process skip penalties when challenge expires ───────
export async function processSkipsForChallenge(challengeId: string, groupId: string) {
  // Get all group members
  const members = await query(
    `SELECT user_id FROM group_members WHERE group_id = $1`,
    [groupId]
  );

  // Get who responded (non-skip)
  const responded = await query(
    `SELECT user_id FROM challenge_responses WHERE challenge_id = $1 AND response_type != 'skip'`,
    [challengeId]
  );
  const respondedIds = new Set(responded.rows.map((r: any) => r.user_id));

  // Get group penalty type
  const group = await query(`SELECT skip_penalty_type FROM groups WHERE id = $1`, [groupId]);
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

      // ── Streak Shield: check before resetting streak ──
      const currentStreakResult = await query(
        `SELECT current_streak FROM group_members WHERE group_id = $1 AND user_id = $2`,
        [groupId, member.user_id]
      );
      const currentStreak = currentStreakResult.rows[0]?.current_streak || 0;

      const shield = await query(
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
        const remainingShields = await query(
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
        const SILLY_AVATARS = ['🤡', '🐸', '💩', '👻', '🤖', '👽', '🦄', '🐔'];

        // Fetch group personality and user display name for AI penalty generation
        let penaltyData: any;
        if (penaltyType === 'avatar_change') {
          penaltyData = { silly_avatar: SILLY_AVATARS[Math.floor(Math.random() * SILLY_AVATARS.length)] };
        } else {
          // Use AI to generate penalty text (falls back to hardcoded internally)
          try {
            const groupPersonalityResult = await query(`SELECT ai_personality FROM groups WHERE id = $1`, [groupId]);
            const personality: AiPersonality = groupPersonalityResult.rows[0]?.ai_personality || 'funny';
            const userNameResult = await query(`SELECT COALESCE(display_name, phone_number) AS display_name FROM users WHERE id = $1`, [member.user_id]);
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

  // ── Group Streak: update based on whether everyone responded ──
  if (!anyoneSkipped && members.rows.length > 0) {
    await query(
      `UPDATE groups SET group_streak = group_streak + 1, longest_group_streak = GREATEST(longest_group_streak, group_streak + 1) WHERE id = $1`,
      [groupId]
    );
    emitToGroup(groupId, 'group:streak_update', { groupId, groupStreak: null, brokenBy: null });
    // Fetch updated value for socket event
    const updatedGroup = await query(`SELECT group_streak FROM groups WHERE id = $1`, [groupId]);
    emitToGroup(groupId, 'group:streak_update', { groupId, groupStreak: updatedGroup.rows[0]?.group_streak || 0, brokenBy: null });
  } else if (anyoneSkipped) {
    // Get current group streak before resetting (for notification)
    const groupStreakResult = await query(`SELECT group_streak FROM groups WHERE id = $1`, [groupId]);
    const brokenStreak = groupStreakResult.rows[0]?.group_streak || 0;

    await query(`UPDATE groups SET group_streak = 0 WHERE id = $1`, [groupId]);
    emitToGroup(groupId, 'group:streak_update', { groupId, groupStreak: 0, brokenBy: firstSkipperId });

    if (brokenStreak > 0 && firstSkipperId) {
      const skipperName = await query(`SELECT COALESCE(display_name, phone_number) AS display_name FROM users WHERE id = $1`, [firstSkipperId]);
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
