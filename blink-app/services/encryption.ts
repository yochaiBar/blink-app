import { Platform } from 'react-native';
import { File, Directory, Paths } from 'expo-file-system';
import { gcm } from '@noble/ciphers/aes.js';
import { api } from '@/services/api';
import type { EncryptionMetadata } from '@/types/api';

// ── Constants ──
const CACHE_DIR_NAME = 'decrypted-photos';
const GROUP_KEY_PREFIX = 'enc_group_key_';

// ── SecureStore wrapper (matches api.ts pattern) ──
const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    const SecureStore = await import('expo-secure-store');
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(key);
  },
};

// ── Base64 helpers ──
function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ── In-memory cache for group keys ──
const groupKeyCache = new Map<string, Uint8Array>();

/**
 * Retrieve the 256-bit AES group key for the given group.
 * Checks in-memory cache -> SecureStore -> server, and caches at each level.
 */
export async function getGroupKey(groupId: string): Promise<Uint8Array> {
  // 1. In-memory
  const cached = groupKeyCache.get(groupId);
  if (cached) return cached;

  // 2. SecureStore
  const storeKey = `${GROUP_KEY_PREFIX}${groupId}`;
  const stored = await storage.get(storeKey);
  if (stored) {
    const key = base64ToUint8Array(stored);
    groupKeyCache.set(groupId, key);
    return key;
  }

  // 3. Fetch from server
  const { key } = await api<{ key: string }>(`/groups/${groupId}/encryption-key`);
  const keyBytes = base64ToUint8Array(key);

  // Cache
  await storage.set(storeKey, key);
  groupKeyCache.set(groupId, keyBytes);

  return keyBytes;
}

/**
 * Unwrap the per-photo AES key from the encryption metadata using the group key.
 * key_enc format: base64(iv(12) + tag(16) + ciphertext)
 */
function unwrapPhotoKey(keyEnc: string, groupKey: Uint8Array): Uint8Array {
  const wrapped = base64ToUint8Array(keyEnc);
  const iv = wrapped.slice(0, 12);
  const tag = wrapped.slice(12, 28);
  const ciphertext = wrapped.slice(28);

  // noble/ciphers GCM expects tag appended to ciphertext
  const ciphertextWithTag = new Uint8Array(ciphertext.length + tag.length);
  ciphertextWithTag.set(ciphertext);
  ciphertextWithTag.set(tag, ciphertext.length);

  const aes = gcm(groupKey, iv);
  return aes.decrypt(ciphertextWithTag);
}

/**
 * Decrypt an encrypted photo blob using the encryption metadata and group key.
 * Returns the raw JPEG bytes.
 */
export function decryptPhotoBlob(
  encryptedData: Uint8Array,
  metadata: EncryptionMetadata,
  groupKey: Uint8Array,
): Uint8Array {
  // Unwrap the per-photo key
  const photoKey = unwrapPhotoKey(metadata.key_enc, groupKey);

  // Decrypt the photo data
  const iv = base64ToUint8Array(metadata.iv);
  const tag = base64ToUint8Array(metadata.tag);

  // Append tag to encrypted data for noble/ciphers
  const dataWithTag = new Uint8Array(encryptedData.length + tag.length);
  dataWithTag.set(encryptedData);
  dataWithTag.set(tag, encryptedData.length);

  const aes = gcm(photoKey, iv);
  return aes.decrypt(dataWithTag);
}

// ── File system cache for decrypted photos ──

function getCacheDir(): Directory {
  return new Directory(Paths.document, CACHE_DIR_NAME);
}

async function ensureCacheDir(): Promise<void> {
  if (Platform.OS === 'web') return;
  const dir = getCacheDir();
  if (!dir.exists) {
    dir.create();
  }
}

/**
 * Check if a decrypted photo is already cached on disk.
 * Returns the local file URI or null.
 */
export async function getCachedPhotoUri(responseId: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const file = new File(getCacheDir(), `${responseId}.jpg`);
  return file.exists ? file.uri : null;
}

/**
 * Write decrypted JPEG bytes to the file cache.
 * Returns the local file URI.
 */
export async function cacheDecryptedPhoto(responseId: string, jpegBytes: Uint8Array): Promise<string> {
  if (Platform.OS === 'web') {
    // Web: return data URI
    const b64 = uint8ArrayToBase64(jpegBytes);
    return `data:image/jpeg;base64,${b64}`;
  }

  await ensureCacheDir();
  const file = new File(getCacheDir(), `${responseId}.jpg`);
  const b64 = uint8ArrayToBase64(jpegBytes);
  file.write(b64, { encoding: 'base64' });
  return file.uri;
}

/**
 * Clear all encryption data: in-memory key cache, SecureStore keys, and decrypted photo cache.
 * Call on logout.
 */
export async function clearEncryptionData(): Promise<void> {
  // Clear in-memory cache
  const groupIds = Array.from(groupKeyCache.keys());
  groupKeyCache.clear();

  // Clear SecureStore entries
  for (const gid of groupIds) {
    try {
      await storage.remove(`${GROUP_KEY_PREFIX}${gid}`);
    } catch {
      // Ignore individual removal failures
    }
  }

  // Clear file cache
  if (Platform.OS !== 'web') {
    try {
      const dir = getCacheDir();
      if (dir.exists) {
        dir.delete();
      }
    } catch {
      // Ignore cache cleanup failures
    }
  }
}
