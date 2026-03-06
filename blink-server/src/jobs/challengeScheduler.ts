import cron from 'node-cron';
import { query } from '../config/database';
import { generateChallenge, isAiEnabled, AiPersonality } from '../services/aiService';
import { emitToGroup } from '../socket';
import { sendPushToGroup } from '../services/pushNotifications';
import { createNotification } from '../utils/notifications';
import logger from '../utils/logger';

function isEnabled(): boolean {
  return process.env.CHALLENGE_SCHEDULER_ENABLED === 'true';
}

// Check if current hour is within quiet hours
function isQuietHours(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const startMinutes = startH * 60 + (startM || 0);
  const endMinutes = endH * 60 + (endM || 0);

  if (startMinutes <= endMinutes) {
    // e.g., 08:00 to 22:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight: e.g., 22:00 to 08:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

// Probability increases as day progresses toward quiet hours
function shouldFireThisTick(quietStart: string | null): boolean {
  if (!quietStart) return Math.random() < 0.1; // 10% per tick if no quiet hours

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = quietStart.split(':').map(Number);
  const quietStartMinutes = startH * 60 + (startM || 0);

  // Calculate remaining 15-min slots before quiet hours
  let remainingMinutes = quietStartMinutes - currentMinutes;
  if (remainingMinutes <= 0) remainingMinutes += 24 * 60; // wrap around

  const remainingSlots = Math.max(1, Math.floor(remainingMinutes / 15));

  // Probability = 1/remaining_slots (ensures it fires before quiet hours)
  return Math.random() < (1 / remainingSlots);
}

// Pick challenge type, avoiding recent repeats
function pickChallengeType(recentTypes: string[]): 'snap' | 'quiz' {
  const weights = { snap: 3, quiz: 2 }; // 60% snap, 40% quiz

  // Reduce weight of recently used types
  const lastType = recentTypes[0];
  if (lastType === 'snap') weights.snap = 1;
  if (lastType === 'quiz') weights.quiz = 1;

  const total = weights.snap + weights.quiz;
  const rand = Math.random() * total;
  return rand < weights.snap ? 'snap' : 'quiz';
}

async function runSchedulerTick(): Promise<void> {
  // Get all active groups (at least 2 members) that haven't had an auto-challenge today
  const groupsResult = await query(`
    SELECT g.id, g.name, g.ai_personality, g.quiet_hours_start::text, g.quiet_hours_end::text,
           COUNT(gm.id)::int as member_count
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    LEFT JOIN challenge_schedule cs ON cs.group_id = g.id
    WHERE (cs.last_auto_challenge_at IS NULL OR cs.last_auto_challenge_at < CURRENT_DATE)
    GROUP BY g.id, g.name, g.ai_personality, g.quiet_hours_start, g.quiet_hours_end
    HAVING COUNT(gm.id) >= 2
  `);

  for (const group of groupsResult.rows) {
    try {
      // Skip if in quiet hours
      if (isQuietHours(group.quiet_hours_start, group.quiet_hours_end)) continue;

      // Probabilistic firing
      if (!shouldFireThisTick(group.quiet_hours_start)) continue;

      await createAutoChallenge(group);
    } catch (err: any) {
      logger.error('Auto-challenge failed for group', { groupId: group.id, error: err.message });
    }
  }
}

async function createAutoChallenge(group: any): Promise<void> {
  const personality: AiPersonality = group.ai_personality || 'funny';

  // Fetch member names
  const membersResult = await query(
    `SELECT u.display_name FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1`,
    [group.id]
  );
  const memberNames = membersResult.rows.map((r: any) => r.display_name);

  // Fetch recent challenge prompts
  const recentResult = await query(
    `SELECT type, prompt_text FROM challenges WHERE group_id = $1 ORDER BY triggered_at DESC LIMIT 5`,
    [group.id]
  );
  const recentChallenges = recentResult.rows.map((r: any) => r.prompt_text).filter(Boolean);
  const recentTypes = recentResult.rows.map((r: any) => r.type);

  // Generate challenge via AI
  const _challengeType = pickChallengeType(recentTypes);
  const aiChallenge = await generateChallenge(group.id, personality, memberNames, recentChallenges);

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry

  // Insert challenge
  const result = await query(
    `INSERT INTO challenges (group_id, type, prompt_text, options_json, triggered_by, expires_at, countdown_seconds, status, is_auto_generated, ai_generated_prompt)
     VALUES ($1, $2, $3, $4, NULL, $5, 10, 'active', true, $3)
     RETURNING *`,
    [group.id, aiChallenge.type, aiChallenge.prompt, aiChallenge.options?.length ? JSON.stringify(aiChallenge.options) : null, expiresAt]
  );

  const challenge = result.rows[0];

  // Update schedule
  await query(
    `INSERT INTO challenge_schedule (group_id, last_auto_challenge_at, updated_at)
     VALUES ($1, NOW(), NOW())
     ON CONFLICT (group_id) DO UPDATE SET last_auto_challenge_at = NOW(), updated_at = NOW()`,
    [group.id]
  );

  // Emit socket event
  emitToGroup(group.id, 'challenge:started', {
    challenge: { ...challenge, triggered_by_name: 'Blink AI' },
  });

  // Send push to all members
  sendPushToGroup(
    group.id,
    `${group.name}`,
    aiChallenge.prompt || 'New challenge! Respond before time runs out!',
    { type: 'challenge_started', challengeId: challenge.id, groupId: group.id, challengeType: aiChallenge.type, screen: 'challenge' }
  ).catch(() => {});

  // Create notifications for all members
  const allMembers = await query(
    `SELECT user_id FROM group_members WHERE group_id = $1`,
    [group.id]
  );
  for (const member of allMembers.rows) {
    createNotification(
      member.user_id,
      'challenge_started',
      `${group.name}`,
      aiChallenge.prompt || 'New challenge!',
      group.id
    ).catch(() => {});
  }

  logger.info('Auto-challenge created', { groupId: group.id, type: aiChallenge.type, prompt: aiChallenge.prompt });
}

export function startChallengeScheduler(): void {
  if (!isEnabled()) {
    logger.info('Challenge scheduler disabled');
    return;
  }

  // Run every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runSchedulerTick();
    } catch (err: any) {
      logger.error('Scheduler tick failed', { error: err.message });
    }
  });

  logger.info('Challenge scheduler started (every 15 minutes)');
}
