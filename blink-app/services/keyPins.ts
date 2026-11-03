/**
 * Trust-on-first-use pins for other members' device keys.
 *
 * The first time this device sees a member's device public key (in a
 * keyshare request, or in the group's key list) it pins it in secure
 * storage. A key the member hasn't been pinned with is a change: we won't
 * courier the group key to it, and group detail shows "<name>'s security
 * key changed" until the user accepts it.
 *
 * A pin is a SET of accepted keys, so a member using two phones doesn't
 * flip between "match" and "changed": accepting a key adds it.
 *
 * This catches a server swapping its own key in for someone we already
 * know. It can't vouch for the first key seen — comparing safety codes in
 * person would; that's future work (SECURITY.md).
 */

import * as SecureStore from 'expo-secure-store';
import type { DevicePublicKey } from '@/shared/photoProtocol';

const PIN_PREFIX = 'blink.e2e.pin.v1.'; // suffixed with the member's userId
// JSON array of the member ids we hold pins for, so logout can wipe them.
const PIN_INDEX_KEY = 'blink.e2e.pinIndex.v1';

export type PinCheck = 'new' | 'match' | 'changed';

/** The accepted keys for `userId`; a pin from before sets were used is one key. */
async function readPins(userId: string): Promise<string[] | null> {
  const raw = await SecureStore.getItemAsync(PIN_PREFIX + userId);
  if (raw === null) return null;
  try {
    const keys: unknown = JSON.parse(raw);
    if (Array.isArray(keys)) return keys.filter((k): k is string => typeof k === 'string');
  } catch {
    // a bare base64 key
  }
  return [raw];
}

// Pin and index writes are read-modify-write; run them one at a time.
let writeQueue: Promise<unknown> = Promise.resolve();

function serially<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task);
  writeQueue = next.catch(() => undefined);
  return next;
}

async function addPin(userId: string, publicKeyB64: string): Promise<void> {
  const keys = (await readPins(userId)) ?? [];
  if (!keys.includes(publicKeyB64)) keys.push(publicKeyB64);
  await SecureStore.setItemAsync(PIN_PREFIX + userId, JSON.stringify(keys));
  const rawIndex = await SecureStore.getItemAsync(PIN_INDEX_KEY);
  const index: string[] = rawIndex ? JSON.parse(rawIndex) : [];
  if (!index.includes(userId)) {
    index.push(userId);
    await SecureStore.setItemAsync(PIN_INDEX_KEY, JSON.stringify(index));
  }
}

/** Compare `publicKeyB64` with the member's pins, pinning it if they have none yet. */
export function checkPin(userId: string, publicKeyB64: string): Promise<PinCheck> {
  return serially(async () => {
    const keys = await readPins(userId);
    if (keys === null) {
      await addPin(userId, publicKeyB64);
      return 'new';
    }
    return keys.includes(publicKeyB64) ? 'match' : 'changed';
  });
}

/** The user accepted a member's new key: add it to their pins. */
export function acceptKeyChange(userId: string, publicKeyB64: string): Promise<void> {
  return serially(() => addPin(userId, publicKeyB64));
}

/** The keys (other than `selfUserId`'s) not among their member's pins; first-seen keys get pinned. */
export async function changedKeys(keys: DevicePublicKey[], selfUserId: string): Promise<DevicePublicKey[]> {
  const changed: DevicePublicKey[] = [];
  for (const key of keys) {
    if (key.user_id === selfUserId) continue;
    if ((await checkPin(key.user_id, key.x25519_public_key_b64)) === 'changed') changed.push(key);
  }
  return changed;
}

/** Logout / account deletion: forget every pin. */
export function wipeAllPins(): Promise<void> {
  return serially(async () => {
    const rawIndex = await SecureStore.getItemAsync(PIN_INDEX_KEY);
    const index: string[] = rawIndex ? JSON.parse(rawIndex) : [];
    await Promise.all(index.map((userId) => SecureStore.deleteItemAsync(PIN_PREFIX + userId)));
    await SecureStore.deleteItemAsync(PIN_INDEX_KEY);
  });
}
