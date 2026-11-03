/**
 * Lifecycle housekeeping, every 30 s: finalize expired challenges and send
 * the one-minute reminders. Always on — reads no longer expire anything.
 */
import { expireDueChallenges, sendDueReminders } from '../services/challengeLifecycle';
import logger from '../utils/logger';

export const CHALLENGE_JOB_INTERVAL_MS = 30 * 1000;

export async function runChallengeJobs(): Promise<void> {
  try {
    const expired = await expireDueChallenges();
    if (expired > 0) logger.info('Expired challenges finalized', { count: expired });
  } catch (err: unknown) {
    logger.error('Challenge expiry job failed', { error: err instanceof Error ? err.message : String(err) });
  }
  try {
    await sendDueReminders();
  } catch (err: unknown) {
    logger.error('Challenge reminder job failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function startChallengeJobs(): void {
  setInterval(() => void runChallengeJobs(), CHALLENGE_JOB_INTERVAL_MS).unref();
  logger.info('Challenge jobs started (every 30s)');
}
