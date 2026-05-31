/**
 * Local photo storage for the E2E private flow.
 *
 * Plan: ~/Documents/Obsidian Vault/Blink/Plans/No server photo storage — E2E private photo flow.md
 *
 * Holds plaintext photo bytes in the app's sandbox (iOS Data Protection
 * encrypts at rest when the device is locked; Android Keystore-backed
 * encryption on supported devices). Two stores live here:
 *
 *   1. RECEIVED store — photos other group members sent, that we've decrypted
 *      and cached for the feed/reveal screens. Eviction: LRU + cap.
 *   2. SENDER store   — plaintext of photos WE sent, kept for 7 days after
 *      the challenge expires so we can re-encrypt + re-relay when a missed
 *      recipient comes online (Q1=b pickup-on-demand).
 *
 * Both stores write to disk through expo-file-system's legacy stable API
 * (the new class-based API in SDK 54 has API churn we don't want to ride
 * yet). All paths live under `documentDirectory + 'photos/'`.
 */

import {
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
  deleteAsync,
  readDirectoryAsync,
  EncodingType,
} from 'expo-file-system/legacy';
import { bytesToB64, b64ToBytes } from '@/services/groupCrypto';

// ── Paths ─────────────────────────────────────────────────────────

const ROOT = `${documentDirectory ?? ''}photos/`;
const RECEIVED_DIR = `${ROOT}received/`;
const SENDER_DIR = `${ROOT}sender/`;

// ── Caps & TTLs ───────────────────────────────────────────────────

/** Maximum number of received photos to keep on disk before LRU eviction. */
const RECEIVED_MAX_COUNT = 1000;
/** Hard cap on bytes across the received store. Soft target — eviction kicks
 *  in when EITHER count or bytes is exceeded. 500 MB. */
const RECEIVED_MAX_BYTES = 500 * 1024 * 1024;
/** Sender plaintext cache TTL — 7 days from creation. */
const SENDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Utilities ─────────────────────────────────────────────────────

async function ensureDirs(): Promise<void> {
  // makeDirectoryAsync with intermediates=true is idempotent; cheap to call.
  for (const dir of [ROOT, RECEIVED_DIR, SENDER_DIR]) {
    const info = await getInfoAsync(dir);
    if (!info.exists) {
      await makeDirectoryAsync(dir, { intermediates: true });
    }
  }
}

function receivedPath(responseId: string): string {
  return `${RECEIVED_DIR}${responseId}.bin`;
}

function senderPath(responseId: string): string {
  return `${SENDER_DIR}${responseId}.bin`;
}

// ── Received store ────────────────────────────────────────────────

/** Writes a decrypted photo to the received store. Idempotent on re-write. */
export async function putReceivedPhoto(
  responseId: string,
  plaintext: Uint8Array,
): Promise<void> {
  await ensureDirs();
  await writeAsStringAsync(receivedPath(responseId), bytesToB64(plaintext), {
    encoding: EncodingType.Base64,
  });
  // Best-effort eviction; runs in background so writes stay fast.
  evictIfNeeded().catch(() => undefined);
}

/** Returns the decrypted bytes for a response photo, or null if not cached. */
export async function getReceivedPhoto(
  responseId: string,
): Promise<Uint8Array | null> {
  const path = receivedPath(responseId);
  const info = await getInfoAsync(path);
  if (!info.exists) return null;
  const b64 = await readAsStringAsync(path, { encoding: EncodingType.Base64 });
  return b64ToBytes(b64);
}

/** True iff we have the decrypted photo cached locally. */
export async function hasReceivedPhoto(responseId: string): Promise<boolean> {
  const info = await getInfoAsync(receivedPath(responseId));
  return info.exists;
}

/** Returns a file:// URI usable by Image components, or null. */
export async function getReceivedPhotoUri(
  responseId: string,
): Promise<string | null> {
  const path = receivedPath(responseId);
  const info = await getInfoAsync(path);
  return info.exists ? path : null;
}

// ── Sender plaintext cache ────────────────────────────────────────

/**
 * Writes the sender's plaintext for a photo we just sent. Kept for
 * SENDER_TTL_MS so we can re-encrypt for a recipient who comes online later.
 */
export async function putSenderPlaintext(
  responseId: string,
  plaintext: Uint8Array,
): Promise<void> {
  await ensureDirs();
  await writeAsStringAsync(senderPath(responseId), bytesToB64(plaintext), {
    encoding: EncodingType.Base64,
  });
}

/**
 * Reads the sender's cached plaintext for a response, if still present and
 * within TTL. Callers should expect null and handle "photo expired" gracefully.
 */
export async function getSenderPlaintext(
  responseId: string,
): Promise<Uint8Array | null> {
  const path = senderPath(responseId);
  const info = await getInfoAsync(path);
  if (!info.exists) return null;
  // modificationTime is seconds since epoch on iOS/Android.
  const modMs = info.modificationTime * 1000;
  if (modMs > 0 && Date.now() - modMs > SENDER_TTL_MS) {
    await deleteAsync(path, { idempotent: true });
    return null;
  }
  const b64 = await readAsStringAsync(path, { encoding: EncodingType.Base64 });
  return b64ToBytes(b64);
}

/** Sweep the sender store of TTL-expired plaintexts. Call on app foreground. */
export async function sweepExpiredSenderPlaintexts(): Promise<number> {
  await ensureDirs();
  const names = await readDirectoryAsync(SENDER_DIR);
  const now = Date.now();
  let removed = 0;
  for (const name of names) {
    const path = `${SENDER_DIR}${name}`;
    const info = await getInfoAsync(path);
    if (!info.exists) continue;
    const modMs = info.modificationTime * 1000;
    if (modMs > 0 && now - modMs > SENDER_TTL_MS) {
      await deleteAsync(path, { idempotent: true });
      removed++;
    }
  }
  return removed;
}

// ── LRU eviction for the received store ───────────────────────────

interface FileMeta {
  path: string;
  modificationTime: number;
  size: number;
}

/**
 * Evicts oldest files from the received store until both count and byte
 * budgets are satisfied. Pure best-effort; if the filesystem throws, the
 * caller of putReceivedPhoto has already written its file successfully.
 */
async function evictIfNeeded(): Promise<void> {
  const names = await readDirectoryAsync(RECEIVED_DIR);
  if (names.length === 0) return;

  const metas: FileMeta[] = [];
  let totalBytes = 0;
  for (const name of names) {
    const path = `${RECEIVED_DIR}${name}`;
    const info = await getInfoAsync(path);
    if (!info.exists) continue;
    metas.push({
      path,
      modificationTime: info.modificationTime,
      size: info.size,
    });
    totalBytes += info.size;
  }

  if (metas.length <= RECEIVED_MAX_COUNT && totalBytes <= RECEIVED_MAX_BYTES) {
    return;
  }

  // Oldest first.
  metas.sort((a, b) => a.modificationTime - b.modificationTime);
  for (const m of metas) {
    if (
      metas.length - 1 < RECEIVED_MAX_COUNT &&
      totalBytes - m.size <= RECEIVED_MAX_BYTES
    ) {
      // hypothetical removal would satisfy both budgets — but only stop if
      // ALSO our current state already satisfies them.
      if (metas.length <= RECEIVED_MAX_COUNT && totalBytes <= RECEIVED_MAX_BYTES) {
        break;
      }
    }
    await deleteAsync(m.path, { idempotent: true });
    totalBytes -= m.size;
    const idx = metas.indexOf(m);
    if (idx >= 0) metas.splice(idx, 1);
    if (metas.length <= RECEIVED_MAX_COUNT && totalBytes <= RECEIVED_MAX_BYTES) {
      break;
    }
  }
}

// ── Account-deletion / sign-out wipe ──────────────────────────────

/**
 * Removes EVERY local photo (received + sender plaintexts). Called when the
 * user signs out or deletes their account — no leftover decrypted bytes from
 * a previous identity must persist on the device.
 */
export async function wipeAllPhotos(): Promise<void> {
  for (const dir of [RECEIVED_DIR, SENDER_DIR]) {
    const info = await getInfoAsync(dir);
    if (info.exists) {
      await deleteAsync(dir, { idempotent: true });
    }
  }
  // Recreate empty dirs so subsequent writes don't fail.
  await ensureDirs();
}

// ── Test seam (not exported for production callers) ───────────────

// Public so unit tests can locate paths without re-deriving them. Not
// considered part of the production API surface.
export const _TEST_INTERNALS = {
  ROOT,
  RECEIVED_DIR,
  SENDER_DIR,
  RECEIVED_MAX_COUNT,
  RECEIVED_MAX_BYTES,
  SENDER_TTL_MS,
  receivedPath,
  senderPath,
};
