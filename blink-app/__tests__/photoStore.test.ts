/**
 * photoStore tests — Phase 3 of the E2E photo flow.
 *
 * Uses an in-memory mock for expo-file-system/legacy so tests run hermetically.
 * The mock is a tiny shim: a Map<path, {bytes, mtime}> plus path-prefix dir
 * checks. Good enough to exercise read/write/delete/list/TTL.
 */

import './setup';

// ── In-memory FS mock ─────────────────────────────────────────────
// Defined BEFORE jest.mock and referenced via factory, because jest hoists
// jest.mock calls and we need the data to outlive the factory closure.
const fsMemory = new Map<string, { b64: string; modificationTime: number }>();
const fsDirs = new Set<string>();
const fsNow = { value: Date.now() }; // advanceable clock for TTL tests

jest.mock('expo-file-system/legacy', () => {
  return {
    documentDirectory: 'file:///doc/',
    EncodingType: { Base64: 'base64', UTF8: 'utf8' },
    async getInfoAsync(uri: string) {
      if (fsMemory.has(uri)) {
        const meta = fsMemory.get(uri)!;
        return {
          exists: true,
          uri,
          size: Math.floor(meta.b64.length * 0.75), // base64 -> bytes
          isDirectory: false,
          modificationTime: meta.modificationTime,
          md5: undefined,
        };
      }
      if (fsDirs.has(uri)) {
        return { exists: true, uri, isDirectory: true, size: 0, modificationTime: 0, md5: undefined };
      }
      return { exists: false, uri, isDirectory: false };
    },
    async makeDirectoryAsync(uri: string) {
      fsDirs.add(uri);
    },
    async readAsStringAsync(uri: string) {
      const m = fsMemory.get(uri);
      if (!m) throw new Error('ENOENT');
      return m.b64;
    },
    async writeAsStringAsync(uri: string, b64: string) {
      fsMemory.set(uri, { b64, modificationTime: Math.floor(fsNow.value / 1000) });
    },
    async deleteAsync(uri: string) {
      fsMemory.delete(uri);
      fsDirs.delete(uri);
      // Recursively delete matching prefix (matches real behavior for dirs).
      for (const k of Array.from(fsMemory.keys())) {
        if (k.startsWith(uri.endsWith('/') ? uri : uri + '/')) fsMemory.delete(k);
      }
    },
    async readDirectoryAsync(uri: string) {
      const prefix = uri.endsWith('/') ? uri : uri + '/';
      const names = new Set<string>();
      for (const k of fsMemory.keys()) {
        if (k.startsWith(prefix)) names.add(k.slice(prefix.length));
      }
      return Array.from(names);
    },
  };
});

import {
  putReceivedPhoto,
  getReceivedPhoto,
  hasReceivedPhoto,
  getReceivedPhotoUri,
  putSenderPlaintext,
  getSenderPlaintext,
  sweepExpiredSenderPlaintexts,
  wipeAllPhotos,
  _TEST_INTERNALS,
} from '../services/photoStore';

const RESPONSE_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
const RESPONSE_B = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';

beforeEach(() => {
  fsMemory.clear();
  fsDirs.clear();
  // Lock Date.now() and the mock filesystem's mtime source to the same
  // virtual clock so TTL math is deterministic regardless of wall time.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  fsNow.value = Date.now();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('photoStore — received store', () => {
  it('round-trips bytes through put + get', async () => {
    const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    await putReceivedPhoto(RESPONSE_A, plaintext);
    const out = await getReceivedPhoto(RESPONSE_A);
    expect(out).toEqual(plaintext);
  });

  it('returns null for an unknown response_id', async () => {
    const out = await getReceivedPhoto(RESPONSE_A);
    expect(out).toBeNull();
  });

  it('hasReceivedPhoto reflects presence', async () => {
    expect(await hasReceivedPhoto(RESPONSE_A)).toBe(false);
    await putReceivedPhoto(RESPONSE_A, new Uint8Array([9, 9]));
    expect(await hasReceivedPhoto(RESPONSE_A)).toBe(true);
  });

  it('getReceivedPhotoUri returns a file:// path when present', async () => {
    await putReceivedPhoto(RESPONSE_A, new Uint8Array([9, 9]));
    const uri = await getReceivedPhotoUri(RESPONSE_A);
    expect(uri).toBe(_TEST_INTERNALS.receivedPath(RESPONSE_A));
  });

  it('overwrites cleanly on re-write (idempotent)', async () => {
    await putReceivedPhoto(RESPONSE_A, new Uint8Array([1, 2, 3]));
    await putReceivedPhoto(RESPONSE_A, new Uint8Array([4, 5, 6]));
    expect(await getReceivedPhoto(RESPONSE_A)).toEqual(new Uint8Array([4, 5, 6]));
  });
});

describe('photoStore — sender plaintext cache + TTL', () => {
  it('round-trips before TTL', async () => {
    const plaintext = new Uint8Array([10, 20, 30]);
    await putSenderPlaintext(RESPONSE_A, plaintext);
    const out = await getSenderPlaintext(RESPONSE_A);
    expect(out).toEqual(plaintext);
  });

  it('returns null after TTL elapses (auto-delete)', async () => {
    await putSenderPlaintext(RESPONSE_A, new Uint8Array([1, 2, 3]));
    // Advance both Date.now() and the mock fs clock past the 7-day TTL.
    jest.advanceTimersByTime(_TEST_INTERNALS.SENDER_TTL_MS + 1000);
    fsNow.value = Date.now();
    const out = await getSenderPlaintext(RESPONSE_A);
    expect(out).toBeNull();
    // And the file should have been deleted by the getter.
    expect(fsMemory.has(_TEST_INTERNALS.senderPath(RESPONSE_A))).toBe(false);
  });

  it('sweepExpiredSenderPlaintexts removes only stale rows', async () => {
    await putSenderPlaintext(RESPONSE_A, new Uint8Array([1]));
    await putSenderPlaintext(RESPONSE_B, new Uint8Array([2]));

    // Age out only A — re-write B at "now" after the clock advances.
    jest.advanceTimersByTime(_TEST_INTERNALS.SENDER_TTL_MS + 1000);
    fsNow.value = Date.now();
    await putSenderPlaintext(RESPONSE_B, new Uint8Array([2])); // bumps mtime

    const removed = await sweepExpiredSenderPlaintexts();
    expect(removed).toBe(1);
    expect(await getSenderPlaintext(RESPONSE_A)).toBeNull();
    expect(await getSenderPlaintext(RESPONSE_B)).not.toBeNull();
  });
});

describe('photoStore — wipeAllPhotos', () => {
  it('removes everything (received + sender), restores empty dirs', async () => {
    await putReceivedPhoto(RESPONSE_A, new Uint8Array([1]));
    await putSenderPlaintext(RESPONSE_B, new Uint8Array([2]));
    await wipeAllPhotos();
    expect(await getReceivedPhoto(RESPONSE_A)).toBeNull();
    expect(await getSenderPlaintext(RESPONSE_B)).toBeNull();
    // Subsequent writes don't fail (dirs restored).
    await putReceivedPhoto(RESPONSE_A, new Uint8Array([9]));
    expect(await getReceivedPhoto(RESPONSE_A)).toEqual(new Uint8Array([9]));
  });
});
