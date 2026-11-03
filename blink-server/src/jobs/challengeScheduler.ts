import cron from 'node-cron';
import { query } from '../config/database';
import { emitToGroup } from '../socket';
import { sendPushToGroup } from '../services/pushNotifications';
import { createNotification } from '../utils/notifications';
import logger from '../utils/logger';

/** Shape returned by the scheduler's group query */
interface SchedulerGroupRow {
  id: string;
  name: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  member_count: number;
}

// Fixed pool of snap prompts for auto-challenges (no AI). Stage 2c moves
// this into jobs/dailyChallenge.ts with per-group scheduling.
export const AUTO_CHALLENGE_PROMPTS = [
  'Show us what you see right now!',
  'Selfie time! No filters allowed',
  'What are you doing RIGHT NOW?',
  'Show us your current view',
  'Quick! Snap your surroundings!',
  'Show us something that made you smile today',
  'What did you last eat? Show us!',
  'Show us your outfit today',
];

/** A random prompt, avoiding the group's most recent ones when possible. */
export function pickAutoPrompt(recentPrompts: string[]): string {
  const fresh = AUTO_CHALLENGE_PROMPTS.filter((p) => !recentPrompts.includes(p));
  const pool = fresh.length > 0 ? fresh : AUTO_CHALLENGE_PROMPTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

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
  return Math.random() < 1 / remainingSlots;
}

async function runSchedulerTick(): Promise<void> {
  // Get all active groups (at least 2 members) that haven't had an auto-challenge today
  const groupsResult = await query<SchedulerGroupRow>(`
    SELECT g.id, g.name, g.quiet_hours_start::text, g.quiet_hours_end::text,
           COUNT(gm.id)::int as member_count
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE NOT EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.group_id = g.id AND c.is_auto_generated AND c.created_at >= CURRENT_DATE
    )
    GROUP BY g.id, g.name, g.quiet_hours_start, g.quiet_hours_end
    HAVING COUNT(gm.id) >= 2
  `);

  for (const group of groupsResult.rows) {
    try {
      // Skip if in quiet hours
      if (isQuietHours(group.quiet_hours_start, group.quiet_hours_end)) continue;

      // Probabilistic firing
      if (!shouldFireThisTick(group.quiet_hours_start)) continue;

      await createAutoChallenge(group);
    } catch (err: unknown) {
      logger.error('Auto-challenge failed for group', {
        groupId: group.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function createAutoChallenge(group: SchedulerGroupRow): Promise<void> {
  // Fetch recent challenge prompts so the same one doesn't repeat back-to-back
  const recentResult = await query<{ prompt: string | null }>(
    `SELECT prompt FROM challenges WHERE group_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [group.id],
  );
  const recentPrompts = recentResult.rows.map((r) => r.prompt).filter((p): p is string => !!p);
  const prompt = pickAutoPrompt(recentPrompts);

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry

  // Insert challenge (created_by NULL = created by the scheduler)
  const result = await query(
    `INSERT INTO challenges (group_id, prompt, created_by, expires_at, status, is_auto_generated)
     VALUES ($1, $2, NULL, $3, 'active', true)
     RETURNING *`,
    [group.id, prompt, expiresAt],
  );

  const challenge = result.rows[0];

  // Emit socket event
  emitToGroup(group.id, 'challenge:started', {
    challenge: { ...challenge, triggered_by_name: 'Blink' },
  });

  // Send push to all members
  sendPushToGroup(group.id, `${group.name}`, prompt, {
    type: 'challenge_started',
    challengeId: challenge.id,
    groupId: group.id,
    challengeType: 'snap',
    screen: 'challenge',
  }).catch(() => {});

  // Create notifications for all members
  const allMembers = await query(`SELECT user_id FROM group_members WHERE group_id = $1`, [group.id]);
  for (const member of allMembers.rows) {
    createNotification(member.user_id, 'challenge_started', `${group.name}`, prompt, group.id).catch(() => {});
  }

  logger.info('Auto-challenge created', { groupId: group.id, prompt });
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
    } catch (err: unknown) {
      logger.error('Scheduler tick failed', { error: err instanceof Error ? err.message : String(err) });
    }
  });

  logger.info('Challenge scheduler started (every 15 minutes)');
}
