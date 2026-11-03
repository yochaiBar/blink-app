/**
 * Photo relays that failed after the response was recorded — offline, a
 * key version that moved on, no group key yet. The response already exists
 * on the server (a second /respond is refused), so the photo has to go out
 * later instead: the sender's plaintext cache keeps it for 7 days, and
 * retryPendingRelays() sends what's queued on foreground, on reconnect and
 * when a group key arrives.
 */

import * as SecureStore from 'expo-secure-store';
import { getSenderPlaintext } from '@/services/photoStore';
import { sendPhoto } from '@/services/photoTransfer';

const QUEUE_KEY = 'blink.relay.retry.v1';
const MAX_JOBS = 20;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface RelayJob {
  groupId: string;
  challengeId: string;
  responseId: string;
  senderUserId: string;
  queuedAt: number;
}

async function readJobs(): Promise<RelayJob[]> {
  try {
    const raw = await SecureStore.getItemAsync(QUEUE_KEY);
    const jobs: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(jobs) ? (jobs as RelayJob[]) : [];
  } catch {
    return [];
  }
}

// Queue writes are read-modify-write; run them one at a time.
let queue: Promise<unknown> = Promise.resolve();

function serially<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task);
  queue = next.catch(() => undefined);
  return next;
}

/** Remember a relay to retry (one per response; the newest MAX_JOBS are kept). */
export function queueRelayRetry(job: Omit<RelayJob, 'queuedAt'>): Promise<void> {
  return serially(async () => {
    const jobs = (await readJobs()).filter((j) => j.responseId !== job.responseId);
    jobs.push({ ...job, queuedAt: Date.now() });
    await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(jobs.slice(-MAX_JOBS)));
  });
}

let retryInFlight: Promise<number> | null = null;

/**
 * Try every queued relay once. Sent and hopeless ones (too old, plaintext
 * gone) leave the queue; failures stay for next time. Single-flight.
 * Returns how many were sent.
 */
export function retryPendingRelays(): Promise<number> {
  retryInFlight ??= serially(async () => {
    const remaining: RelayJob[] = [];
    let sent = 0;
    for (const job of await readJobs()) {
      if (Date.now() - job.queuedAt > MAX_AGE_MS) continue;
      const plaintext = await getSenderPlaintext(job.responseId);
      if (!plaintext) continue;
      try {
        await sendPhoto({ ...job, plaintext });
        sent++;
      } catch {
        remaining.push(job);
      }
    }
    await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(remaining));
    return sent;
  }).finally(() => {
    retryInFlight = null;
  });
  return retryInFlight;
}

/** Logout / account deletion. */
export function clearRelayRetries(): Promise<void> {
  return serially(() => SecureStore.deleteItemAsync(QUEUE_KEY));
}
