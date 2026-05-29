/**
 * Wire-format types for the no-server-storage photo flow.
 *
 * ⚠️ DUPLICATE FILE — MUST stay byte-identical with
 * `blink-app/shared/photoProtocol.ts`. The packages don't share a node_modules
 * boundary; this is the pragmatic alternative to a workspace setup for one
 * spec file. CI should diff the two on every PR (script: TODO).
 *
 * Pure TypeScript interfaces, no runtime, no React. The server additionally
 * validates incoming payloads with a matching Zod schema (see
 * `blink-server/src/utils/schemas.ts`); the app trusts these types statically.
 *
 * Plan: ~/Documents/Obsidian Vault/Blink/Plans/No server photo storage — E2E private photo flow.md
 *
 * Versioning rule
 * ───────────────
 * Every payload carries `v: 1` as the first field. Protocol changes WILL
 * happen; bumping `v` lets old and new clients/servers negotiate gracefully.
 * Treat unknown `v` as an error — never best-effort-parse.
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

// ── Photo relay (Phase 3) ───────────────────────────────────────

/**
 * Sender → server: an encrypted photo to be fanned out to the listed
 * recipient user IDs. The server never decrypts; it only routes.
 *
 * The bulk ciphertext travels as a Socket.io binary frame in Phase 3, not as
 * a base64 string in a JSON body. The HTTP request that arrives at
 * `POST /api/photos/relay` carries the addressing metadata + a body stream
 * (the ciphertext), and the relay route hands the stream to relayHub which
 * fans it out without ever materializing the bytes in a logged structure.
 */
export interface RelayPhotoMetadata {
  v: 1;
  group_id: string;
  challenge_id: string;
  response_id: string;
  // Per-photo random IV (12 bytes for AES-GCM). MUST be freshly generated for
  // every encrypt call — never reused with the same group key (Plan H2 guard).
  iv_b64: string;
  // GCM auth tag (16 bytes). Appended to ciphertext on the wire; carried
  // separately here so the server can do length sanity checks without parsing
  // ciphertext bytes.
  auth_tag_b64: string;
  // Bytes the server will see; sender promises this matches the request body
  // length so the server can refuse oversized payloads early.
  ciphertext_byte_length: number;
  // The recipient user IDs the sender expects to deliver to. Server intersects
  // with group membership at fan-out time (defense in depth).
  recipient_user_ids: string[];
}

/**
 * Server → recipient (via Socket.io): a photo to decrypt. Bytes ride as a
 * binary frame attached to the event; this object is the addressing envelope.
 */
export interface IncomingPhotoEnvelope {
  v: 1;
  group_id: string;
  challenge_id: string;
  response_id: string;
  sender_user_id: string;
  sender_device_id: string;
  iv_b64: string;
  auth_tag_b64: string;
}

/**
 * Recipient → server (via Socket.io ACK): explicit decryption outcome.
 * Server uses these to update `pending_photo_pickups` and to alert on
 * crypto failures via the `photo:decrypt_failed` rate metric (Plan §
 * "Observability of a blind server").
 */
export type PhotoDecryptErrorCode =
  | 'KEY_MISSING'         // recipient doesn't have the group key
  | 'AUTH_TAG_FAIL'       // ciphertext tampered or wrong key
  | 'VERSION_MISMATCH'    // payload v doesn't match a version this client knows
  | 'BAD_PAYLOAD';        // malformed envelope / bytes

export interface PhotoIncomingAck {
  v: 1;
  response_id: string;
  ok: true;
}

export interface PhotoIncomingNack {
  v: 1;
  response_id: string;
  ok: false;
  error: PhotoDecryptErrorCode;
}

// ── Pickup-on-demand (Phase 3, Q1=b) ────────────────────────────

/**
 * Server → sender (via Socket.io): "Recipient X just came online and is owed
 * the photo for response_id Y. Please re-encrypt for X and relay it."
 *
 * Routed to the sender's originating device specifically (not any device of
 * the sender's account) — the originating device is the one that has the
 * plaintext cached locally.
 */
export interface PhotoPickupRequest {
  v: 1;
  response_id: string;
  recipient_user_id: string;
  recipient_device_id: string;
  recipient_x25519_public_key_b64: string;
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
