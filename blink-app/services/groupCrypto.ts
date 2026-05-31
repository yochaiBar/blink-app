/**
 * Client-side cryptography for the E2E photo flow.
 *
 * Plan: ~/Documents/Obsidian Vault/Blink/Plans/No server photo storage — E2E private photo flow.md
 * Wire-format types: @/shared/photoProtocol
 *
 * This module is intentionally framework-free (no React, no Expo imports
 * other than `expo-secure-store` for persistence). That keeps every
 * primitive unit-testable in plain Node + Jest, which matters because
 * crypto bugs only show up in tests if the tests can actually exercise
 * the real primitives.
 *
 * What this module owns
 * ─────────────────────
 *  • Device X25519 long-lived keypair: generate, persist seed, re-derive.
 *  • Per-device attestation HMAC for registering the public key.
 *  • Group key generation (256-bit random) + persistence per group.
 *  • Symmetric encrypt/decrypt for photo bytes (AES-256-GCM, fresh IV every call).
 *  • Asymmetric encrypt/decrypt for the courier handshake (X25519 → HKDF → AES-GCM).
 *
 * What this module does NOT own
 * ─────────────────────────────
 *  • Network transport. Callers wire the outputs to the relay endpoint
 *    and to socket events themselves.
 *  • Local photo plaintext storage. That lives in `services/photoStore.ts`
 *    (Phase 3) which uses `expo-file-system`.
 */

import 'react-native-get-random-values'; // belt-and-suspenders; _layout.tsx also imports it at the top of the bundle
import * as SecureStore from 'expo-secure-store';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';

// ── Constants ─────────────────────────────────────────────────────

const DEVICE_SEED_KEY = 'blink.e2e.deviceSeed.v1';
const DEVICE_ID_KEY = 'blink.e2e.deviceId.v1';
const GROUP_KEY_PREFIX = 'blink.e2e.groupKey.v1.'; // suffixed with groupId

export const KEY_BYTES = 32; // both X25519 keys and AES-256 keys
export const GCM_IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;

// HKDF info strings — bind derivation context so the same shared secret
// can't accidentally be reused across protocols.
const HKDF_INFO_KEYSHARE = new TextEncoder().encode('blink/v1/keyshare');

// ── Encoding helpers ──────────────────────────────────────────────

export function bytesToB64(b: Uint8Array): string {
  // React Native's btoa expects a binary string, which we build manually
  // because TextDecoder('binary') is not universally available.
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  // global btoa is available in RN + Node 18+
  return btoa(s);
}

export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Device keypair ────────────────────────────────────────────────

export interface DeviceKeyMaterial {
  device_id: string;
  publicKey: Uint8Array;       // 32 bytes
  privateScalar: Uint8Array;   // 32 bytes (the X25519 seed)
}

/**
 * Loads the device keypair from secure storage, generating a new one on the
 * first call. The 32-byte seed IS the X25519 private key (clamped on use).
 *
 * Why store the seed and not the keypair object: smaller (32 vs 64+ bytes),
 * fits comfortably within `expo-secure-store`'s Android keystore size limits,
 * and the public key is cheap to re-derive on demand.
 */
export async function getOrCreateDeviceKey(): Promise<DeviceKeyMaterial> {
  const [seedB64, deviceId] = await Promise.all([
    SecureStore.getItemAsync(DEVICE_SEED_KEY),
    SecureStore.getItemAsync(DEVICE_ID_KEY),
  ]);

  if (seedB64 && deviceId) {
    const privateScalar = b64ToBytes(seedB64);
    const publicKey = x25519.getPublicKey(privateScalar);
    return { device_id: deviceId, publicKey, privateScalar };
  }

  // Generate fresh keypair. crypto.getRandomValues is provided by the
  // polyfill `react-native-get-random-values` (imported at the top of
  // this file AND at the top of `app/_layout.tsx`).
  const privateScalar = randomBytes(KEY_BYTES);
  const publicKey = x25519.getPublicKey(privateScalar);
  const newDeviceId = uuidv4();

  await Promise.all([
    SecureStore.setItemAsync(DEVICE_SEED_KEY, bytesToB64(privateScalar)),
    SecureStore.setItemAsync(DEVICE_ID_KEY, newDeviceId),
  ]);

  return { device_id: newDeviceId, publicKey, privateScalar };
}

/**
 * For tests + an account-deletion flow: wipe the device keypair. After this,
 * the next `getOrCreateDeviceKey()` will generate a fresh one.
 */
export async function clearDeviceKey(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(DEVICE_SEED_KEY),
    SecureStore.deleteItemAsync(DEVICE_ID_KEY),
  ]);
}

/**
 * HMAC-SHA256(JWT-access-token-bytes, public_key_bytes). Server re-derives
 * the same and compares with timingSafeEqual (Plan H1). Bind the public-key
 * registration to the authenticated session so cross-user replay fails.
 */
export function computeAttestation(
  accessToken: string,
  publicKey: Uint8Array,
): Uint8Array {
  return hmac(sha256, new TextEncoder().encode(accessToken), publicKey);
}

// ── Group key ─────────────────────────────────────────────────────

/**
 * Generates a fresh 32-byte AES-256 group key. Caller is responsible for
 * persisting it via `storeGroupKey` AND for sharing it to other group
 * members via the courier handshake.
 */
export function newGroupKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export async function storeGroupKey(
  groupId: string,
  key: Uint8Array,
): Promise<void> {
  await SecureStore.setItemAsync(GROUP_KEY_PREFIX + groupId, bytesToB64(key));
}

export async function loadGroupKey(groupId: string): Promise<Uint8Array | null> {
  const v = await SecureStore.getItemAsync(GROUP_KEY_PREFIX + groupId);
  return v ? b64ToBytes(v) : null;
}

export async function deleteGroupKey(groupId: string): Promise<void> {
  await SecureStore.deleteItemAsync(GROUP_KEY_PREFIX + groupId);
}

// ── Symmetric encrypt/decrypt for photo bytes ─────────────────────

export interface EncryptedBlob {
  ciphertext: Uint8Array;  // includes the 16-byte GCM auth tag at the end
  iv: Uint8Array;          // 12 bytes
}

/**
 * AES-256-GCM. The IV is generated fresh on every call — the caller does
 * NOT pass one in. Reusing an IV with the same key would catastrophically
 * break GCM's confidentiality and authenticity, so the API simply does not
 * give callers the rope to reuse one (Plan H2 guard).
 *
 * Note: `@noble/ciphers`' gcm appends the auth tag to the ciphertext, so the
 * returned `ciphertext` length is `plaintext.length + 16`. The matching
 * `aesGcmDecrypt` expects the same shape.
 */
export function aesGcmEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
): EncryptedBlob {
  if (key.length !== KEY_BYTES) {
    throw new Error(`aesGcmEncrypt: key must be ${KEY_BYTES} bytes`);
  }
  const iv = randomBytes(GCM_IV_BYTES);
  const ciphertext = gcm(key, iv).encrypt(plaintext);
  return { ciphertext, iv };
}

export function aesGcmDecrypt(
  key: Uint8Array,
  blob: EncryptedBlob,
): Uint8Array {
  if (key.length !== KEY_BYTES) {
    throw new Error(`aesGcmDecrypt: key must be ${KEY_BYTES} bytes`);
  }
  if (blob.iv.length !== GCM_IV_BYTES) {
    throw new Error(`aesGcmDecrypt: iv must be ${GCM_IV_BYTES} bytes`);
  }
  if (blob.ciphertext.length < GCM_TAG_BYTES) {
    throw new Error('aesGcmDecrypt: ciphertext shorter than GCM tag');
  }
  // gcm.decrypt throws on auth-tag failure → fail closed. Callers should
  // treat the throw as AUTH_TAG_FAIL.
  return gcm(key, blob.iv).decrypt(blob.ciphertext);
}

// ── Courier handshake — encrypt the group key for a joiner's device ─

export interface CourierEnvelope {
  ephemeralPublicKey: Uint8Array; // 32 bytes
  iv: Uint8Array;                 // 12 bytes
  ciphertext: Uint8Array;         // groupKey (32) + GCM tag (16) = 48 bytes
}

/**
 * The courier (an online existing member of the group) encrypts the group
 * key to the joiner's static device public key.
 *
 * Protocol:
 *   1. Generate an ephemeral X25519 keypair on the courier side.
 *   2. ECDH(ephemeral_private, joiner_static_public) → 32-byte shared secret.
 *   3. HKDF-SHA256(salt=ephemeralPub||joinerPub, info=HKDF_INFO_KEYSHARE) → 32-byte AEAD key.
 *   4. AES-256-GCM encrypt the group key under the AEAD key with a fresh IV.
 *   5. Send {ephemeralPub, iv, ciphertext} through the (blind) server.
 *
 * The salt binds the derived key to the specific handshake — preventing
 * cross-handshake replay even though we don't have full forward secrecy on
 * the static device key.
 */
export function courierEncryptGroupKey(
  joinerStaticPublicKey: Uint8Array,
  groupKey: Uint8Array,
): CourierEnvelope {
  if (joinerStaticPublicKey.length !== KEY_BYTES) {
    throw new Error('courierEncryptGroupKey: joiner public key must be 32 bytes');
  }
  if (groupKey.length !== KEY_BYTES) {
    throw new Error('courierEncryptGroupKey: group key must be 32 bytes');
  }

  const ephemeralPrivate = randomBytes(KEY_BYTES);
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivate, joinerStaticPublicKey);

  const salt = new Uint8Array(ephemeralPublic.length + joinerStaticPublicKey.length);
  salt.set(ephemeralPublic, 0);
  salt.set(joinerStaticPublicKey, ephemeralPublic.length);
  const aeadKey = hkdf(sha256, sharedSecret, salt, HKDF_INFO_KEYSHARE, KEY_BYTES);

  const { ciphertext, iv } = aesGcmEncrypt(aeadKey, groupKey);
  return { ephemeralPublicKey: ephemeralPublic, iv, ciphertext };
}

/**
 * The joiner side: decrypt the group key delivered by the courier.
 *
 *   1. ECDH(static_device_private, courier_ephemeral_public) → shared secret.
 *   2. Same HKDF as the courier (salt order: ephemeralPub||joinerPub).
 *   3. AES-256-GCM decrypt.
 *
 * Throws on auth-tag failure (wrong key, tampered ciphertext, or — the
 * MITM scenario we WANT to detect — courier was tricked into encrypting to
 * a server-supplied substitute public key). Callers treat throw as a
 * handshake failure and surface to UX as "couldn't verify group access."
 */
export function joinerDecryptGroupKey(
  joinerStaticPrivate: Uint8Array,
  joinerStaticPublic: Uint8Array,
  envelope: CourierEnvelope,
): Uint8Array {
  if (joinerStaticPrivate.length !== KEY_BYTES) {
    throw new Error('joinerDecryptGroupKey: private key must be 32 bytes');
  }

  const sharedSecret = x25519.getSharedSecret(
    joinerStaticPrivate,
    envelope.ephemeralPublicKey,
  );

  const salt = new Uint8Array(
    envelope.ephemeralPublicKey.length + joinerStaticPublic.length,
  );
  salt.set(envelope.ephemeralPublicKey, 0);
  salt.set(joinerStaticPublic, envelope.ephemeralPublicKey.length);
  const aeadKey = hkdf(sha256, sharedSecret, salt, HKDF_INFO_KEYSHARE, KEY_BYTES);

  return aesGcmDecrypt(aeadKey, {
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
  });
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Minimal RFC4122 v4 UUID. We avoid a dep for one function; falls back to
 * `crypto.getRandomValues` which the polyfill guarantees on RN.
 */
function uuidv4(): string {
  const b = randomBytes(16);
  // Version (4) and variant (10xx) bits per RFC4122.
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(b[i].toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
