/**
 * Trust-on-first-use pins for other members' device keys.
 *
 * The first time this device sees a member's device public key (in a
 * keyshare request, or in the group's key list) it pins it in secure
 * storage. A different key for that member later is a change: we won't
 * courier the group key to it, and group detail shows "<name>'s security
 * key changed" until the user accepts it.
 *
 * This catches a server swapping its own key in for someone we already
 * know. It can't vouch for the first key seen — comparing safety codes in
 * person would; that's future work (SECURITY.md).
 */

import * as SecureStore from 'expo-secure-store';
import type { DevicePublicKey } from '@/shared/photoProtocol';

const PIN_PREFIX = 'blink.e2e.pin.v1.'; // suffixed with the member's userId

export type PinCheck = 'new' | 'match' | 'changed';

/** Compare `publicKeyB64` with the member's pin, pinning it if there is none yet. */
export async function checkPin(userId: string, publicKeyB64: string): Promise<PinCheck> {
  const pinned = await SecureStore.getItemAsync(PIN_PREFIX + userId);
  if (pinned === null) {
    await SecureStore.setItemAsync(PIN_PREFIX + userId, publicKeyB64);
    return 'new';
  }
  return pinned === publicKeyB64 ? 'match' : 'changed';
}

/** The user accepted a member's new key: pin it instead. */
export async function acceptKeyChange(userId: string, publicKeyB64: string): Promise<void> {
  await SecureStore.setItemAsync(PIN_PREFIX + userId, publicKeyB64);
}

/** The keys (other than `selfUserId`'s) that differ from their pins; first-seen keys get pinned. */
export async function changedKeys(keys: DevicePublicKey[], selfUserId: string): Promise<DevicePublicKey[]> {
  const changed: DevicePublicKey[] = [];
  for (const key of keys) {
    if (key.user_id === selfUserId) continue;
    if ((await checkPin(key.user_id, key.x25519_public_key_b64)) === 'changed') changed.push(key);
  }
  return changed;
}
