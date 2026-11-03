/**
 * Wire-format types for the no-server-storage photo flow.
 *
 * ⚠️ DUPLICATE FILE — MUST stay byte-identical with
 * `blink-app/shared/photoProtocol.ts`. The packages don't share a node_modules
 * boundary; this is the pragmatic alternative to a workspace setup for one
 * spec file. CI `cmp`s the two on every PR (contract-checks job).
 *
 * TypeScript interfaces plus the AEAD associated-data builders, so both
 * ends agree on them byte for byte. No imports, no React. The server
 * additionally validates incoming payloads with a matching Zod schema (see
 * `blink-server/src/utils/schemas.ts`); the app trusts these types statically.
 *
 * Plan: ~/Documents/Obsidian Vault/Blink/Plans/No server photo storage — E2E private photo flow.md
 *
 * Versioning rule
 * ───────────────
 * Every payload carries `v` as the first field. Photo relay payloads are
 * v2 (recovery Stage 3); device keys and the keyshare handshake are still
 * v1. Treat unknown `v` as an error — never best-effort-parse.
 */

// ── Device public keys ──────────────────────────────────────────

/**
 * Registers (or re-registers) a device's X25519 public key with the server.
 *
 * Security: the server cannot trust the public key on its own — a malicious
 * caller could substitute any key. To bind the key to the authenticated user,
 * the device computes
 *     attestation = HMAC-SHA256(key = JWT-sub-bytes, message = x25519_public_key_bytes)
 * and the server re-derives + verifies before accepting (Plan H1 guard).
 *
 * `device_id` is a per-install UUID the app generates on first launch and
 * persists in secure storage alongside the X25519 seed.
 */
export interface RegisterDeviceKeyRequest {
  v: 1;
  device_id: string;
  x25519_public_key_b64: string;
  attestation_b64: string;
}

export interface RegisterDeviceKeyResponse {
  v: 1;
  device_id: string;
  key_version: number;
  registered_at: string; // ISO-8601
}

/**
 * Read endpoint result: a single device's public key, looked up in the context
 * of an in-flight handshake (Plan M2 guard — no bulk listing). The caller must
 * provide a handshake context (response_id or pending_join_id) so the read can
 * be authorized and audit-logged.
 */
export interface DevicePublicKey {
  v: 1;
  user_id: string;
  device_id: string;
  x25519_public_key_b64: string;
  key_version: number;
  // Server-side only; the app never needs to inspect it. Present in responses
  // so a courier can refuse a tombstoned key if a race lets one slip through.
  tombstoned_at: string | null;
}

// ── Associated data (AEAD) ──────────────────────────────────────

/**
 * Associated data bound into every photo's AES-GCM encryption. A
 * ciphertext only decrypts under the exact group, challenge, response,
 * sender and key version it was made for, so the (blind) server can't
 * replay one photo as another response, group or sender.
 */
export function photoAad(args: {
  groupId: string;
  challengeId: string;
  responseId: string;
  senderUserId: string;
  keyVersion: number;
}): string {
  return `blink/photo/v2|${args.groupId}|${args.challengeId}|${args.responseId}|${args.senderUserId}|${args.keyVersion}`;
}

/**
 * Associated data for the group-key courier handshake, used both as the
 * AES-GCM AAD and as the HKDF info: the wrapped key is bound to one group,
 * joiner, joiner device and key version.
 */
export function keyshareAad(args: {
  groupId: string;
  joinerUserId: string;
  joinerDeviceId: string;
  keyVersion: number;
}): string {
  return `blink/keyshare/v2|${args.groupId}|${args.joinerUserId}|${args.joinerDeviceId}|${args.keyVersion}`;
}

// ── Photo relay (v2) ────────────────────────────────────────────

/**
 * Sender → server (`POST /api/photos/relay`): one encrypted photo.
 *
 * The server never decrypts; it only routes, and it decides the routing
 * itself: group and challenge come from the response, the caller must own
 * that response and still be a member, `key_version` must equal the
 * group's current version (409 otherwise), and the recipients are the
 * sender's audience (other members, minus anyone blocked with the sender).
 */
export interface RelayPhotoRequest {
  v: 2;
  response_id: string;
  // The originating device's UUID. Recorded on `pending_photo_pickups` so the
  // server can later target pickup_request to this specific device (the one
  // holding the plaintext locally).
  sender_device_id: string;
  // The group-key version the photo was encrypted under (also in the AAD).
  key_version: number;
  // Per-photo random IV (12 bytes for AES-GCM). MUST be freshly generated for
  // every encrypt call — never reused with the same group key (Plan H2 guard).
  iv_b64: string;
  // The encrypted bytes with the 16-byte GCM tag appended (as @noble/ciphers
  // produces them). Base64 in JSON for simplicity.
  ciphertext_b64: string;
  // OPTIONAL — present when this relay fulfils a pickup_request: the photo
  // goes only to that pickup's recipient.
  pickup_id?: string;
}

export interface RelayPhotoResult {
  v: 2;
  delivered_user_ids: string[];
  queued_user_ids: string[];
}

/**
 * Server → recipient (Socket.io `photo:incoming`, with an ACK callback):
 * a photo to decrypt with the group key at `key_version`, using
 * photoAad(group_id, challenge_id, response_id, sender_user_id, key_version).
 */
export interface IncomingPhotoEnvelope {
  v: 2;
  group_id: string;
  challenge_id: string;
  response_id: string;
  sender_user_id: string;
  sender_device_id: string;
  key_version: number;
  iv_b64: string;
  ciphertext_b64: string;
}

/**
 * Recipient → server (via Socket.io ACK): explicit decryption outcome.
 * Anything but `ok: true` keeps the recipient's pickup queued.
 */
export type PhotoDecryptErrorCode =
  | 'KEY_MISSING' // recipient doesn't have the group key
  | 'AUTH_TAG_FAIL' // ciphertext tampered, wrong key or wrong associated data
  | 'VERSION_MISMATCH' // payload v or key_version doesn't match what this client holds
  | 'BAD_PAYLOAD'; // malformed envelope / bytes

export interface PhotoIncomingAck {
  v: 2;
  response_id: string;
  ok: true;
}

export interface PhotoIncomingNack {
  v: 2;
  response_id: string;
  ok: false;
  error: PhotoDecryptErrorCode;
}

// ── Pickup-on-demand ────────────────────────────────────────────

/**
 * Server → sender's originating device (Socket.io `photo:pickup_request`):
 * "Recipient X is owed the photo for response Y. Please re-encrypt and
 * relay it." Sent only while both are online; the server holds a short
 * lease on the pickup, and an unanswered one is offered again later.
 *
 * The sender re-encrypts the locally cached plaintext with a fresh IV under
 * the current group key and POSTs a RelayPhotoRequest with this `pickup_id`;
 * the server then delivers to that one recipient and drops the pickup.
 */
export interface PhotoPickupRequest {
  v: 2;
  response_id: string;
  challenge_id: string;
  group_id: string;
  recipient_user_id: string;
  pickup_id: string;
}

// ── Group-key handshake (Phase 4, Q2=a) ─────────────────────────

/**
 * Server → courier (via Socket.io): "User X joined group G; please share the
 * group key. Here's X's verified device public key."
 *
 * The server has already verified the joiner's attestation (Plan H1). If two
 * existing members are online, the server picks one deterministically (lowest
 * user_id) and emits `keyshare:cancelled` to the others.
 */
export interface KeyshareRequest {
  v: 1;
  group_id: string;
  joiner_user_id: string;
  joiner_device_id: string;
  joiner_x25519_public_key_b64: string;
  pending_join_id: string;
}

/**
 * Courier → server → joiner (via Socket.io): the group key encrypted to the
 * joiner's device public key.
 *
 * The blob is opaque to the server: ECDH(courier_private, joiner_public)
 * yields a shared secret, run through HKDF to derive an AEAD key, then
 * AES-256-GCM encrypts the group key. Server cannot decrypt.
 */
export interface KeyshareEnvelope {
  v: 1;
  pending_join_id: string;
  group_id: string;
  from_user_id: string;
  from_device_id: string;
  // Ephemeral X25519 public key used for this handshake (the courier's static
  // device key is already registered; ephemeral keys give forward-secrecy on
  // the handshake itself even though we don't have full PFS on photo bytes).
  ephemeral_public_key_b64: string;
  iv_b64: string;
  auth_tag_b64: string;
  ciphertext_b64: string;
  // The group key's version on the courier's side. The joiner stores it
  // alongside the key; rejects shares older than what they already hold
  // (handles reinstall race per the QA findings).
  group_key_version: number;
}
