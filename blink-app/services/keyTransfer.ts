/**
 * Group-key transfer — the courier handshake, app side (protocol v2).
 *
 * The key-side counterpart of photoTransfer: callers (useSocket, useGroups,
 * group detail) use these and never touch the crypto or the endpoints.
 *
 *   • respondToKeyshareRequest — we're the courier: wrap our key for a
 *     joiner's device and deliver it
 *   • acceptKeyshareEnvelope   — we're the joiner: unwrap, decide, confirm, store
 *   • mintGroupKey             — we're the source (new group, solo group,
 *     reset): make a key at the server's version and confirm we hold it
 *
 * Every wrapped key is bound by keyshareAad(group, joiner, joiner device,
 * version), so an envelope only opens on the device and version it was
 * made for. The server checks versions and couriers; it never sees a key.
 */

import { confirmGroupKey, deliverKeyshare } from '@/services/api';
import {
  b64ToBytes,
  bytesToB64,
  courierEncryptGroupKey,
  getOrCreateDeviceKey,
  joinerDecryptGroupKey,
  loadGroupKey,
  loadGroupKeyVersion,
  newGroupKey,
  storeGroupKey,
} from '@/services/groupCrypto';
import type { KeyshareEnvelope, KeyshareRequest } from '@/shared/photoProtocol';

/**
 * Courier path. Shares only the exact version the server asked for — a
 * stale or newer local key would be refused at /deliver anyway. Returns
 * whether an envelope was delivered.
 */
export async function respondToKeyshareRequest(request: KeyshareRequest): Promise<boolean> {
  if (request.v !== 2) return false;
  const [groupKey, keyVersion] = await Promise.all([
    loadGroupKey(request.group_id),
    loadGroupKeyVersion(request.group_id),
  ]);
  if (!groupKey || keyVersion !== request.key_version) return false;

  const envelope = courierEncryptGroupKey(b64ToBytes(request.joiner_x25519_public_key_b64), groupKey, {
    groupId: request.group_id,
    joinerUserId: request.joiner_user_id,
    joinerDeviceId: request.joiner_device_id,
    keyVersion: request.key_version,
  });
  const { device_id: fromDeviceId } = await getOrCreateDeviceKey();
  await deliverKeyshare({
    v: 2,
    pending_join_id: request.pending_join_id,
    from_device_id: fromDeviceId,
    key_version: request.key_version,
    ephemeral_public_key_b64: bytesToB64(envelope.ephemeralPublicKey),
    iv_b64: bytesToB64(envelope.iv),
    ciphertext_b64: bytesToB64(envelope.ciphertext),
  });
  return true;
}

export type EnvelopeOutcome =
  | 'stored' // a new key (first one, or a rotation) is now ours
  | 'unchanged' // we already held exactly this key
  | 'undecryptable' // not for this device / group / version, or tampered
  | 'stale' // older than the key we hold
  | 'conflict' // a different key at the version we hold
  | 'refused'; // the server says it isn't the current version

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * Joiner path. Accepts a key only if its version is not below what we hold
 * and the server confirms it is the group's current version; a different
 * key at our own version is refused (it would strand photos made under
 * ours). Confirming also ends our pending join and makes us a courier.
 */
export async function acceptKeyshareEnvelope(envelope: KeyshareEnvelope, selfUserId: string): Promise<EnvelopeOutcome> {
  if (envelope.v !== 2) return 'undecryptable';
  const device = await getOrCreateDeviceKey();

  let groupKey: Uint8Array;
  try {
    groupKey = joinerDecryptGroupKey(
      device.privateScalar,
      device.publicKey,
      {
        ephemeralPublicKey: b64ToBytes(envelope.ephemeral_public_key_b64),
        iv: b64ToBytes(envelope.iv_b64),
        ciphertext: b64ToBytes(envelope.ciphertext_b64),
      },
      // Our own view of the context: an envelope made for another group,
      // device or version fails to decrypt.
      {
        groupId: envelope.group_id,
        joinerUserId: selfUserId,
        joinerDeviceId: device.device_id,
        keyVersion: envelope.key_version,
      },
    );
  } catch {
    return 'undecryptable';
  }

  const [existing, localVersion] = await Promise.all([
    loadGroupKey(envelope.group_id),
    loadGroupKeyVersion(envelope.group_id),
  ]);
  if (envelope.key_version < localVersion) return 'stale';
  const unchanged = existing !== null && sameBytes(existing, groupKey) && envelope.key_version === localVersion;
  if (existing && !unchanged && envelope.key_version === localVersion) return 'conflict';

  // The server has the last word on which version is current.
  try {
    await confirmGroupKey({ group_id: envelope.group_id, key_version: envelope.key_version });
  } catch {
    return 'refused';
  }
  if (unchanged) return 'unchanged';
  await storeGroupKey(envelope.group_id, groupKey, envelope.key_version);
  return 'stored';
}

/**
 * Source path: make a fresh key at the server's `version` and confirm we
 * hold it, so we can courier it (and, after a reset, so members hear of it).
 */
export async function mintGroupKey(groupId: string, version: number): Promise<void> {
  await storeGroupKey(groupId, newGroupKey(), version);
  await confirmGroupKey({ group_id: groupId, key_version: version });
}
