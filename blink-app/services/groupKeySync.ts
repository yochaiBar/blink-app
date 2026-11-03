/**
 * Reconcile each group's local key with the server (useGroupKeySync runs
 * it whenever the groups list loads or changes):
 *
 *   • Solo group, no key → mint locally (no one to diverge from) and confirm it.
 *   • Multi-member group, no key → ask a holder of the current key to
 *     courier it (stalled join, reinstall).
 *   • Key older than the server's version → an admin reset it; ask too.
 *   • Key at the server's version → (re-)confirm it, so the server knows we
 *     can courier it. Idempotent.
 *
 * A group synced in the last minute is skipped, so refetches and remounts
 * don't flood the server with requests.
 */

import { confirmGroupKey, requestKeyshare } from '@/services/api';
import { getOrCreateDeviceKey, loadGroupKey, loadGroupKeyVersion } from '@/services/groupCrypto';
import { mintGroupKey } from '@/services/keyTransfer';
import type { Group } from '@/types';

export const GROUP_KEY_SYNC_INTERVAL_MS = 60_000;

const lastSynced = new Map<string, number>();

type SyncableGroup = Pick<Group, 'id' | 'members' | 'memberCount' | 'groupKeyVersion'>;

async function syncGroupKey(group: SyncableGroup): Promise<void> {
  const memberCount = group.memberCount ?? group.members?.length ?? 0;
  const serverVersion = group.groupKeyVersion ?? 1;
  const [key, localVersion] = await Promise.all([loadGroupKey(group.id), loadGroupKeyVersion(group.id)]);

  if (!key && memberCount <= 1) {
    await mintGroupKey(group.id, serverVersion);
  } else if (!key || localVersion < serverVersion) {
    const { device_id } = await getOrCreateDeviceKey();
    await requestKeyshare({ group_id: group.id, device_id });
  } else if (localVersion === serverVersion) {
    await confirmGroupKey({ group_id: group.id, key_version: localVersion });
  }
}

/** Reconcile every group not synced in the last minute. Failures retry on the next pass. */
export async function syncGroupKeys(groups: SyncableGroup[], now: number = Date.now()): Promise<void> {
  for (const group of groups) {
    const last = lastSynced.get(group.id);
    if (last !== undefined && now - last < GROUP_KEY_SYNC_INTERVAL_MS) continue;
    lastSynced.set(group.id, now);
    try {
      await syncGroupKey(group);
    } catch (err) {
      lastSynced.delete(group.id);
      if (__DEV__) console.warn('[groupKeySync] failed', group.id, err);
    }
  }
}

/** Forget the de-dupe state (logout). */
export function resetGroupKeySync(): void {
  lastSynced.clear();
}
