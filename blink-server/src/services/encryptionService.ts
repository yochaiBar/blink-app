import crypto from 'crypto';
import { query } from '../config/database';
import logger from '../utils/logger';
import { GroupEncryptionKeyRow } from '../types/db';

// ── Configuration ───────────────────────────────────────────────

/**
 * Returns true when server-side photo encryption is enabled.
 * Requires both PHOTO_ENCRYPTION_ENABLED=true and a valid ENCRYPTION_MASTER_KEY.
 */
export function isEncryptionEnabled(): boolean {
  return (
    process.env.PHOTO_ENCRYPTION_ENABLED === 'true' &&
    typeof process.env.ENCRYPTION_MASTER_KEY === 'string' &&
    process.env.ENCRYPTION_MASTER_KEY.length === 64
  );
}

/**
 * Read the 256-bit master key from the ENCRYPTION_MASTER_KEY env var (64 hex chars).
 * Throws if the env var is missing or malformed.
 */
export function getMasterKey(): Buffer {
  const hex = process.env.ENCRYPTION_MASTER_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_MASTER_KEY must be a 64-character hex string (256-bit key)');
  }
  return Buffer.from(hex, 'hex');
}

// ── Primitive crypto helpers ────────────────────────────────────

/** Generate a random 256-bit key. */
export function generateKey(): Buffer {
  return crypto.randomBytes(32);
}

/** AES-256-GCM encrypt with a random 12-byte IV. */
export function encryptAes256Gcm(
  plaintext: Buffer,
  key: Buffer,
): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag };
}

/** AES-256-GCM decrypt. */
export function decryptAes256Gcm(
  ciphertext: Buffer,
  key: Buffer,
  iv: Buffer,
  tag: Buffer,
): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ── Key wrapping ────────────────────────────────────────────────

/**
 * Wrap (encrypt) a per-photo key with the group key.
 * Returns a packed buffer: iv(12) + tag(16) + ciphertext.
 */
export function wrapKey(photoKey: Buffer, groupKey: Buffer): Buffer {
  const { ciphertext, iv, tag } = encryptAes256Gcm(photoKey, groupKey);
  return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Unwrap (decrypt) a per-photo key using the group key.
 * Expects packed format: iv(12) + tag(16) + ciphertext.
 */
export function unwrapKey(wrapped: Buffer, groupKey: Buffer): Buffer {
  const iv = wrapped.subarray(0, 12);
  const tag = wrapped.subarray(12, 28);
  const ciphertext = wrapped.subarray(28);
  return decryptAes256Gcm(ciphertext, groupKey, iv, tag);
}

/**
 * Encrypt a group key with the master key.
 * Returns packed format: iv(12) + tag(16) + ciphertext.
 */
export function encryptGroupKey(groupKey: Buffer): Buffer {
  const masterKey = getMasterKey();
  const { ciphertext, iv, tag } = encryptAes256Gcm(groupKey, masterKey);
  return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Decrypt a group key using the master key.
 * Expects packed format: iv(12) + tag(16) + ciphertext.
 */
export function decryptGroupKey(encryptedKey: Buffer): Buffer {
  const masterKey = getMasterKey();
  const iv = encryptedKey.subarray(0, 12);
  const tag = encryptedKey.subarray(12, 28);
  const ciphertext = encryptedKey.subarray(28);
  return decryptAes256Gcm(ciphertext, masterKey, iv, tag);
}

// ── Group key management ────────────────────────────────────────

/**
 * Retrieve the group encryption key for `groupId`, creating one if it does not exist.
 * Uses ON CONFLICT to handle race conditions.
 */
export async function getOrCreateGroupKey(groupId: string): Promise<Buffer> {
  // Try to fetch existing key
  const existing = await query<GroupEncryptionKeyRow>(
    `SELECT encrypted_key FROM group_encryption_keys WHERE group_id = $1`,
    [groupId],
  );

  if (existing.rows.length > 0) {
    return decryptGroupKey(existing.rows[0].encrypted_key);
  }

  // Generate a new group key and persist it (encrypted with master key)
  const groupKey = generateKey();
  const encryptedKey = encryptGroupKey(groupKey);

  await query(
    `INSERT INTO group_encryption_keys (group_id, encrypted_key, key_version)
     VALUES ($1, $2, 1)
     ON CONFLICT (group_id) DO NOTHING`,
    [groupId, encryptedKey],
  );

  // In case of a race, re-fetch to make sure we return the winning row
  const refetch = await query<GroupEncryptionKeyRow>(
    `SELECT encrypted_key FROM group_encryption_keys WHERE group_id = $1`,
    [groupId],
  );

  if (refetch.rows.length > 0) {
    return decryptGroupKey(refetch.rows[0].encrypted_key);
  }

  // Should not happen — return the key we generated
  return groupKey;
}

// ── High-level photo encryption ─────────────────────────────────

export interface EncryptedPhotoResult {
  encryptedBuffer: Buffer;
  metadata: {
    v: number;
    alg: string;
    iv: string;
    tag: string;
    key_enc: string;
  };
}

/**
 * Encrypt a photo buffer using a fresh per-photo key, wrapped with the group key.
 *
 * Returns the encrypted buffer and metadata needed for decryption.
 */
export async function encryptPhoto(
  photoBuffer: Buffer,
  groupId: string,
): Promise<EncryptedPhotoResult> {
  const groupKey = await getOrCreateGroupKey(groupId);
  const photoKey = generateKey();

  // Encrypt the photo with the per-photo key
  const { ciphertext, iv, tag } = encryptAes256Gcm(photoBuffer, photoKey);

  // Wrap the per-photo key with the group key
  const wrappedKey = wrapKey(photoKey, groupKey);

  return {
    encryptedBuffer: ciphertext,
    metadata: {
      v: 1,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      key_enc: wrappedKey.toString('base64'),
    },
  };
}
