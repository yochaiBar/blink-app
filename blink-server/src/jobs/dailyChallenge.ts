/**
 * The daily auto-challenge: once a day per group, at a random time between
 * DAY_START_HOUR and DAY_END_HOUR in the group's own timezone, start a snap
 * challenge from a fixed prompt list (no AI).
 *
 * Each group carries `next_auto_challenge_at`. A tick claims due groups with
 * FOR UPDATE SKIP LOCKED and reschedules them in the same transaction before
 * creating anything, so several replicas never double-fire. Gated by
 * CHALLENGE_SCHEDULER_ENABLED.
 */
import { query, withTransaction } from '../config/database';
import { env } from '../config/env';
import { createChallenge } from '../services/challengeLifecycle';
import { HttpError } from '../utils/httpError';
import logger from '../utils/logger';

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

export const DAY_START_HOUR = 10;
export const DAY_END_HOUR = 20;
const TICK_INTERVAL_MS = 60 * 1000;

/** A random prompt, avoiding the group's most recent ones when possible. */
export function pickAutoPrompt(recentPrompts: string[]): string {
  const fresh = AUTO_CHALLENGE_PROMPTS.filter((p) => !recentPrompts.includes(p));
  const pool = fresh.length > 0 ? fresh : AUTO_CHALLENGE_PROMPTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of `instant` in `timeZone`. */
function localParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** The instant at which the wall clock in `timeZone` reads the given time. */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  // Two passes settle the offset, DST transitions included.
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += wanted - shown;
  }
  return new Date(guess);
}

/** A random daytime slot on the group's next local calendar day after `from`. */
export function nextAutoChallengeAt(
  timeZone: string,
  from: Date = new Date(),
  random: () => number = Math.random,
): Date {
  const today = localParts(from, timeZone);
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const minutes = DAY_START_HOUR * 60 + Math.floor(random() * (DAY_END_HOUR - DAY_START_HOUR) * 60);
  return zonedTimeToUtc(
    timeZone,
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate(),
    Math.floor(minutes / 60),
    minutes % 60,
  );
}

interface DueGroup {
  id: string;
  timezone: string;
  member_count: number;
}

/** Claim due groups, reschedule them, then start their challenges. Returns how many started. */
export async function runDailyChallengeTick(now: Date = new Date()): Promise<number> {
  const due = await withTransaction(async (client) => {
    const result = await client.query<DueGroup>(
      `SELECT g.id, g.timezone,
              (SELECT COUNT(*)::int FROM group_members WHERE group_id = g.id) AS member_count
         FROM groups g
        WHERE g.next_auto_challenge_at <= $1
        ORDER BY g.next_auto_challenge_at
        LIMIT 20
        FOR UPDATE SKIP LOCKED`,
      [now],
    );
    for (const g of result.rows) {
      await client.query(`UPDATE groups SET next_auto_challenge_at = $2 WHERE id = $1`, [
        g.id,
        nextAutoChallengeAt(g.timezone, now),
      ]);
    }
    return result.rows;
  });

  let started = 0;
  for (const g of due) {
    if (g.member_count < 2) continue; // nobody to play with yet
    try {
      const recent = await query<{ prompt: string | null }>(
        `SELECT prompt FROM challenges WHERE group_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [g.id],
      );
      await createChallenge({
        groupId: g.id,
        createdBy: null,
        prompt: pickAutoPrompt(recent.rows.map((r) => r.prompt).filter((p): p is string => !!p)),
      });
      started++;
    } catch (err: unknown) {
      // 409: a member started one seconds ago — today's challenge is covered.
      if (err instanceof HttpError && err.status === 409) continue;
      logger.error('Daily challenge failed for group', {
        groupId: g.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return started;
}

export function startDailyChallengeJob(): void {
  if (env.CHALLENGE_SCHEDULER_ENABLED !== 'true') {
    logger.info('Daily challenge scheduler disabled');
    return;
  }
  setInterval(() => {
    runDailyChallengeTick().catch((err: unknown) => {
      logger.error('Daily challenge tick failed', { error: err instanceof Error ? err.message : String(err) });
    });
  }, TICK_INTERVAL_MS).unref();
  logger.info('Daily challenge scheduler started (every minute)');
}
