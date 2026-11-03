/**
 * Photo transfer pipeline — encrypt → relay → receive → decrypt.
 *
 * Plan: ~/Documents/Obsidian Vault/Blink/Plans/No server photo storage — E2E private photo flow.md
 *
 * Three entry points:
 *   • sendPhoto    — encrypt plaintext + POST to /api/photos/relay (protocol v2)
 *   • receivePhoto — handle incoming socket envelope: decrypt + store
 *   • respondToPickup — server asked us to re-send for a now-online recipient
 *
 * This module is the only place app-side that knows the relay protocol.
 * Callers (FeedItem, snap-challenge screen, useSocket) talk to it via the
 * three functions below and never touch the crypto or the relay endpoint
 * directly.
 *
 * Privacy contract honored here
 * ─────────────────────────────
 * Plaintext only ever exists in three places on disk:
 *   1. the camera capture temp file (briefly, before we ingest)
 *   2. the SENDER's local plaintext cache (photoStore, 7-day TTL)
 *   3. each RECIPIENT's received cache (photoStore, LRU eviction)
 * Server NEVER holds plaintext. Ciphertext flows through the server in
 * memory only and is freed once the relay route returns.
 *
 * Every photo is encrypted with photoAad(group, challenge, response, sender,
 * key version) as associated data, so it only decrypts in the context it
 * was made for. The server picks the recipients; the app never sends a list.
 */

import {
  aadBytes,
  aesGcmEncrypt,
  aesGcmDecrypt,
  b64ToBytes,
  bytesToB64,
  getOrCreateDeviceKey,
  loadGroupKey,
  loadGroupKeyVersion,
} from '@/services/groupCrypto';
import { getReceivedPhoto, getSenderPlaintext, putReceivedPhoto, putSenderPlaintext } from '@/services/photoStore';
import { relayPhoto } from '@/services/api';
import {
  photoAad,
  type IncomingPhotoEnvelope,
  type PhotoDecryptErrorCode,
  type PhotoIncomingAck,
  type PhotoIncomingNack,
  type PhotoPickupRequest,
} from '@/shared/photoProtocol';

// ── Limits ────────────────────────────────────────────────────────

/**
 * Pre-encryption size cap. Matches the server's `maxHttpBufferSize` (8 MB)
 * minus headroom for the AEAD tag + JSON envelope overhead. Photos taken
 * by phone cameras are typically 1–3 MB after camera-side compression; this
 * leaves plenty of room.
 */
export const MAX_PHOTO_BYTES = 7 * 1024 * 1024;

// ── Public API ────────────────────────────────────────────────────

export interface SendPhotoArgs {
  groupId: string;
  challengeId: string;
  responseId: string;
  /** The sender (this user); bound into the associated data. */
  senderUserId: string;
  /** Raw photo bytes (e.g. read from the camera result with expo-file-system). */
  plaintext: Uint8Array;
}

export interface SendPhotoResult {
  delivered: string[];
  queued: string[];
}

interface EncryptArgs {
  groupKey: Uint8Array;
  groupId: string;
  challengeId: string;
  responseId: string;
  senderUserId: string;
  plaintext: Uint8Array;
  pickupId?: string;
}

/** Encrypt under the local group key (at its stored version) and POST one v2 relay. */
async function encryptAndRelay(args: EncryptArgs): Promise<SendPhotoResult> {
  const keyVersion = await loadGroupKeyVersion(args.groupId);
  const { device_id: senderDeviceId } = await getOrCreateDeviceKey();
  const aad = aadBytes(
    photoAad({
      groupId: args.groupId,
      challengeId: args.challengeId,
      responseId: args.responseId,
      senderUserId: args.senderUserId,
      keyVersion,
    }),
  );
  const { ciphertext, iv } = aesGcmEncrypt(args.groupKey, args.plaintext, aad);

  const res = await relayPhoto({
    v: 2,
    response_id: args.responseId,
    sender_device_id: senderDeviceId,
    key_version: keyVersion,
    iv_b64: bytesToB64(iv),
    ciphertext_b64: bytesToB64(ciphertext),
    ...(args.pickupId ? { pickup_id: args.pickupId } : {}),
  });
  return { delivered: res.delivered_user_ids, queued: res.queued_user_ids };
}

/**
 * Sender path: encrypt with the group key, POST the ciphertext to
 * /api/photos/relay, cache plaintext locally for pickup-on-demand. The
 * server sends it to the sender's audience (other members it may reach).
 *
 * Throws if:
 *   • plaintext exceeds MAX_PHOTO_BYTES
 *   • the group key isn't loaded (the device hasn't completed a handshake
 *     for this group yet — caller should surface a meaningful UX)
 *   • the relay refuses it, e.g. 409 when the local key version is stale
 */
export async function sendPhoto(args: SendPhotoArgs): Promise<SendPhotoResult> {
  if (args.plaintext.length > MAX_PHOTO_BYTES) {
    throw new Error(`photoTransfer.sendPhoto: payload ${args.plaintext.length} bytes exceeds cap ${MAX_PHOTO_BYTES}`);
  }
  const groupKey = await loadGroupKey(args.groupId);
  if (!groupKey) {
    throw new Error(`photoTransfer.sendPhoto: no group key for ${args.groupId}; handshake required`);
  }

  // Cache plaintext locally so we can re-encrypt for offline recipients
  // (pickup-on-demand). Best-effort — if this fails the send still succeeds
  // for online recipients; only the pickup path degrades.
  putSenderPlaintext(args.responseId, args.plaintext).catch(() => undefined);

  return encryptAndRelay({ ...args, groupKey });
}

function nack(responseId: string, error: PhotoDecryptErrorCode): PhotoIncomingNack {
  return { v: 2, response_id: responseId, ok: false, error };
}

/**
 * Recipient path: decrypt a `photo:incoming` envelope and persist the
 * plaintext to the local received-photos store. Returns an ACK/NACK payload
 * that the socket handler emits back via `emitWithAck`; a NACK keeps the
 * pickup queued on the server.
 *
 * Idempotent: receiving the same envelope twice is fine — the photoStore
 * write overwrites the existing file.
 */
export async function receivePhoto(envelope: IncomingPhotoEnvelope): Promise<PhotoIncomingAck | PhotoIncomingNack> {
  if (envelope.v !== 2) return nack(envelope.response_id, 'VERSION_MISMATCH');

  // Already cached? Skip the decrypt — ACK so the server drops the pickup.
  // Useful when a pickup re-delivers a photo we already have.
  if (await getReceivedPhoto(envelope.response_id)) {
    return { v: 2, response_id: envelope.response_id, ok: true };
  }

  const [groupKey, keyVersion] = await Promise.all([
    loadGroupKey(envelope.group_id),
    loadGroupKeyVersion(envelope.group_id),
  ]);
  if (!groupKey) return nack(envelope.response_id, 'KEY_MISSING');
  // Encrypted under a key version we don't hold (we're behind a rotation, or
  // the sender is): keep it queued until the keys line up.
  if (envelope.key_version !== keyVersion) return nack(envelope.response_id, 'VERSION_MISMATCH');

  let ciphertext: Uint8Array;
  let iv: Uint8Array;
  try {
    ciphertext = b64ToBytes(envelope.ciphertext_b64);
    iv = b64ToBytes(envelope.iv_b64);
  } catch {
    return nack(envelope.response_id, 'BAD_PAYLOAD');
  }

  const aad = aadBytes(
    photoAad({
      groupId: envelope.group_id,
      challengeId: envelope.challenge_id,
      responseId: envelope.response_id,
      senderUserId: envelope.sender_user_id,
      keyVersion: envelope.key_version,
    }),
  );
  let plaintext: Uint8Array;
  try {
    plaintext = aesGcmDecrypt(groupKey, { ciphertext, iv }, aad);
  } catch {
    // GCM throws on auth-tag failure: tampered ciphertext, wrong key, or a
    // photo relabelled with another group / response / sender / version.
    return nack(envelope.response_id, 'AUTH_TAG_FAIL');
  }

  try {
    await putReceivedPhoto(envelope.response_id, plaintext);
  } catch {
    // Disk write failed — NACK so the server keeps the pickup; we'll get it
    // again on the next pickup round-trip.
    return nack(envelope.response_id, 'BAD_PAYLOAD');
  }

  return { v: 2, response_id: envelope.response_id, ok: true };
}

/**
 * Server asked us to re-send for a specific recipient who is now online.
 * Look up the cached plaintext, re-encrypt with a fresh IV under the current
 * group key, POST with `pickup_id` so the server delivers to that recipient.
 *
 * Returns null if we no longer have the plaintext (TTL expired or user
 * cleared storage) or the group key. Caller (socket handler) should swallow
 * the null — the server reaps the pickup after its TTL.
 */
export async function respondToPickup(
  request: PhotoPickupRequest,
  senderUserId: string,
): Promise<SendPhotoResult | null> {
  if (request.v !== 2) return null;
  const plaintext = await getSenderPlaintext(request.response_id);
  if (!plaintext) return null;
  const groupKey = await loadGroupKey(request.group_id);
  if (!groupKey) return null;

  return encryptAndRelay({
    groupKey,
    groupId: request.group_id,
    challengeId: request.challenge_id,
    responseId: request.response_id,
    senderUserId,
    plaintext,
    pickupId: request.pickup_id,
  });
}
