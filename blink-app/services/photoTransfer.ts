/**
 * Photo transfer pipeline — encrypt → relay → receive → decrypt.
 *
 * Plan: ~/Documents/Obsidian Vault/Blink/Plans/No server photo storage — E2E private photo flow.md
 *
 * Three entry points:
 *   • sendPhoto    — encrypt plaintext + POST to /api/photos/relay
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
 *   1. expo-image-picker temp file (briefly, before we ingest)
 *   2. the SENDER's local plaintext cache (photoStore, 7-day TTL)
 *   3. each RECIPIENT's received cache (photoStore, LRU eviction)
 * Server NEVER holds plaintext. Ciphertext flows through the server in
 * memory only and is freed once the relay route returns.
 */

import {
  GCM_TAG_BYTES,
  aesGcmEncrypt,
  aesGcmDecrypt,
  b64ToBytes,
  bytesToB64,
  getOrCreateDeviceKey,
  loadGroupKey,
} from '@/services/groupCrypto';
import {
  getReceivedPhoto,
  getSenderPlaintext,
  putReceivedPhoto,
  putSenderPlaintext,
} from '@/services/photoStore';
import { relayPhoto } from '@/services/api';
import type {
  IncomingPhotoEnvelope,
  PhotoIncomingAck,
  PhotoIncomingNack,
  PhotoPickupRequest,
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
  recipientUserIds: string[];
  /** Raw photo bytes (e.g. read from the camera result with expo-file-system). */
  plaintext: Uint8Array;
}

export interface SendPhotoResult {
  delivered: string[];
  queued: string[];
}

/**
 * Sender path: encrypt with the group key, POST the ciphertext + addressing
 * to /api/photos/relay, cache plaintext locally for pickup-on-demand.
 *
 * Throws if:
 *   • plaintext exceeds MAX_PHOTO_BYTES
 *   • the group key isn't loaded (the device hasn't completed a handshake
 *     for this group yet — caller should surface a meaningful UX)
 */
export async function sendPhoto(args: SendPhotoArgs): Promise<SendPhotoResult> {
  if (args.plaintext.length > MAX_PHOTO_BYTES) {
    throw new Error(
      `photoTransfer.sendPhoto: payload ${args.plaintext.length} bytes exceeds cap ${MAX_PHOTO_BYTES}`,
    );
  }
  const groupKey = await loadGroupKey(args.groupId);
  if (!groupKey) {
    throw new Error(
      `photoTransfer.sendPhoto: no group key for ${args.groupId}; handshake required`,
    );
  }

  const { device_id: senderDeviceId } = await getOrCreateDeviceKey();
  const { ciphertext, iv } = aesGcmEncrypt(groupKey, args.plaintext);

  // @noble/ciphers AES-GCM appends the 16-byte tag to the ciphertext. Split
  // so the server sees `ciphertext_b64` (data + tag concatenated) and a
  // separate `auth_tag_b64` for size sanity checks. We send them combined
  // in ciphertext; auth_tag_b64 is the tag portion alone.
  const tag = ciphertext.slice(ciphertext.length - GCM_TAG_BYTES);

  // Cache plaintext locally so we can re-encrypt for offline recipients
  // (pickup-on-demand). Best-effort — if this fails the send still succeeds
  // for online recipients; only the pickup path degrades.
  putSenderPlaintext(args.responseId, args.plaintext).catch(() => undefined);

  const res = await relayPhoto({
    v: 1,
    group_id: args.groupId,
    challenge_id: args.challengeId,
    response_id: args.responseId,
    sender_device_id: senderDeviceId,
    iv_b64: bytesToB64(iv),
    auth_tag_b64: bytesToB64(tag),
    recipient_user_ids: args.recipientUserIds,
    ciphertext_b64: bytesToB64(ciphertext),
  });

  return { delivered: res.delivered_user_ids, queued: res.queued_user_ids };
}

/**
 * Recipient path: decrypt a `photo:incoming` envelope and persist the
 * plaintext to the local received-photos store. Returns an ACK/NACK payload
 * that the socket handler emits back via `emitWithAck`.
 *
 * Idempotent: receiving the same envelope twice is fine — the photoStore
 * write overwrites the existing file.
 */
export async function receivePhoto(
  envelope: IncomingPhotoEnvelope & { ciphertext_b64: string },
): Promise<PhotoIncomingAck | PhotoIncomingNack> {
  // Already cached? Skip the decrypt — declare ACK so the server can mark
  // the pickup terminal. Useful when pickup_request re-delivers a photo we
  // already have.
  if (await getReceivedPhoto(envelope.response_id)) {
    return { v: 1, response_id: envelope.response_id, ok: true };
  }

  const groupKey = await loadGroupKey(envelope.group_id);
  if (!groupKey) {
    return {
      v: 1,
      response_id: envelope.response_id,
      ok: false,
      error: 'KEY_MISSING',
    };
  }

  let ciphertext: Uint8Array;
  let iv: Uint8Array;
  try {
    ciphertext = b64ToBytes(envelope.ciphertext_b64);
    iv = b64ToBytes(envelope.iv_b64);
  } catch {
    return {
      v: 1,
      response_id: envelope.response_id,
      ok: false,
      error: 'BAD_PAYLOAD',
    };
  }

  let plaintext: Uint8Array;
  try {
    plaintext = aesGcmDecrypt(groupKey, { ciphertext, iv });
  } catch {
    // GCM throws on auth-tag failure (tampered ciphertext, wrong key, etc.)
    return {
      v: 1,
      response_id: envelope.response_id,
      ok: false,
      error: 'AUTH_TAG_FAIL',
    };
  }

  try {
    await putReceivedPhoto(envelope.response_id, plaintext);
  } catch (err) {
    // Disk write failed — return NACK so the server keeps the pickup row
    // pending; we'll retry on the next pickup_request roundtrip.
    return {
      v: 1,
      response_id: envelope.response_id,
      ok: false,
      error: 'BAD_PAYLOAD',
    };
  }

  return { v: 1, response_id: envelope.response_id, ok: true };
}

/**
 * Server asked us to re-send for a specific recipient who just came online.
 * Look up the cached plaintext, re-encrypt with a fresh IV, POST with
 * `pickup_id` so the server can ACK the pending row.
 *
 * Returns null if we no longer have the plaintext (TTL expired or user
 * cleared storage). Caller (socket handler) should swallow the null —
 * the server will eventually expire the pending row via its TTL job.
 */
export async function respondToPickup(
  args: PhotoPickupRequest & { challengeId: string },
): Promise<SendPhotoResult | null> {
  const plaintext = await getSenderPlaintext(args.response_id);
  if (!plaintext) return null;

  const groupKey = await loadGroupKey(args.group_id);
  if (!groupKey) return null;

  const { device_id: senderDeviceId } = await getOrCreateDeviceKey();
  const { ciphertext, iv } = aesGcmEncrypt(groupKey, plaintext);
  const tag = ciphertext.slice(ciphertext.length - GCM_TAG_BYTES);

  const res = await relayPhoto({
    v: 1,
    group_id: args.group_id,
    challenge_id: args.challengeId,
    response_id: args.response_id,
    sender_device_id: senderDeviceId,
    iv_b64: bytesToB64(iv),
    auth_tag_b64: bytesToB64(tag),
    recipient_user_ids: [args.recipient_user_id],
    ciphertext_b64: bytesToB64(ciphertext),
    pickup_id: args.pickup_id,
  });

  return { delivered: res.delivered_user_ids, queued: res.queued_user_ids };
}
