/**
 * photoTransfer tests — Phase 3 of the E2E photo flow.
 *
 * Exercises the encrypt+relay and receive+decrypt pipelines using REAL noble
 * crypto and the in-memory FS mock. The relay HTTP call is mocked so tests
 * stay hermetic; the wire payload is asserted so the contract with the
 * server's Zod schema can't drift silently.
 */

import './setup';

// ── In-memory FS mock (same shape as photoStore.test.ts) ─────────
const fsMemory = new Map<string, { b64: string; modificationTime: number }>();
const fsDirs = new Set<string>();
const fsNow = { value: Date.now() };

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  async getInfoAsync(uri: string) {
    if (fsMemory.has(uri)) {
      const m = fsMemory.get(uri)!;
      return {
        exists: true,
        uri,
        size: Math.floor(m.b64.length * 0.75),
        isDirectory: false,
        modificationTime: m.modificationTime,
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
  },
  async readDirectoryAsync(uri: string) {
    const prefix = uri.endsWith('/') ? uri : uri + '/';
    const names = new Set<string>();
    for (const k of fsMemory.keys()) {
      if (k.startsWith(prefix)) names.add(k.slice(prefix.length));
    }
    return Array.from(names);
  },
}));

// ── Mock the relay HTTP call ──────────────────────────────────────
// We need to capture the request body to assert the wire shape.
const mockRelayPhoto = jest.fn();
jest.mock('@/services/api', () => {
  const actual = jest.requireActual('@/services/api');
  return {
    ...actual,
    relayPhoto: (...args: unknown[]) => mockRelayPhoto(...args),
    getAccessToken: () => 'test-access-token',
  };
});

// ── Stateful expo-secure-store backing for these tests ───────────
// setup.ts already mocks the module; we replace its impls with in-memory
// versions in beforeEach so device key + group key persist within a test.
const ssMemory = new Map<string, string>();

import * as SecureStore from 'expo-secure-store';

import {
  sendPhoto,
  receivePhoto,
  respondToPickup,
  MAX_PHOTO_BYTES,
} from '../services/photoTransfer';
import {
  newGroupKey,
  storeGroupKey,
  bytesToB64,
  getOrCreateDeviceKey,
  GCM_TAG_BYTES,
} from '../services/groupCrypto';
import { getReceivedPhoto, getSenderPlaintext } from '../services/photoStore';

const GROUP_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
const CHALLENGE_ID = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
const RESPONSE_ID = 'c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
const RECIPIENT_ID = 'd1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
const PICKUP_ID = 'e1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';

beforeEach(() => {
  fsMemory.clear();
  fsDirs.clear();
  ssMemory.clear();
  mockRelayPhoto.mockReset();
  fsNow.value = Date.now();
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(
    async (k: string) => ssMemory.get(k) ?? null,
  );
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(
    async (k: string, v: string) => {
      ssMemory.set(k, v);
    },
  );
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(
    async (k: string) => {
      ssMemory.delete(k);
    },
  );
});

describe('photoTransfer.sendPhoto', () => {
  it('encrypts, calls relayPhoto with a valid envelope, caches plaintext locally', async () => {
    const groupKey = newGroupKey();
    await storeGroupKey(GROUP_ID, groupKey);
    const plaintext = new TextEncoder().encode('hello world');

    mockRelayPhoto.mockResolvedValueOnce({
      v: 1,
      delivered_user_ids: [RECIPIENT_ID],
      queued_user_ids: [],
    });

    const result = await sendPhoto({
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      responseId: RESPONSE_ID,
      recipientUserIds: [RECIPIENT_ID],
      plaintext,
    });

    expect(result.delivered).toEqual([RECIPIENT_ID]);
    expect(result.queued).toEqual([]);

    // Wire-shape assertions.
    expect(mockRelayPhoto).toHaveBeenCalledTimes(1);
    const body = mockRelayPhoto.mock.calls[0][0];
    expect(body.v).toBe(1);
    expect(body.group_id).toBe(GROUP_ID);
    expect(body.challenge_id).toBe(CHALLENGE_ID);
    expect(body.response_id).toBe(RESPONSE_ID);
    expect(body.recipient_user_ids).toEqual([RECIPIENT_ID]);
    // IV: 12 bytes → 16 base64 chars
    expect(body.iv_b64.length).toBe(16);
    // Tag: 16 bytes → 24 base64 chars
    expect(body.auth_tag_b64.length).toBe(24);
    // Ciphertext: plaintext.length + 16 byte tag, base64'd
    const expectedCipherBytes = plaintext.length + GCM_TAG_BYTES;
    const expectedCipherB64Len = Math.ceil(expectedCipherBytes / 3) * 4;
    expect(body.ciphertext_b64.length).toBe(expectedCipherB64Len);

    // Plaintext cached locally for pickup-on-demand.
    // Give the fire-and-forget putSenderPlaintext a moment to land.
    await new Promise((r) => setTimeout(r, 0));
    expect(await getSenderPlaintext(RESPONSE_ID)).toEqual(plaintext);
  });

  it('produces a fresh IV on every send (H2 — never reused under same key)', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey());
    mockRelayPhoto.mockResolvedValue({ v: 1, delivered_user_ids: [], queued_user_ids: [] });
    const plaintext = new TextEncoder().encode('same content');

    await sendPhoto({
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      responseId: RESPONSE_ID,
      recipientUserIds: [RECIPIENT_ID],
      plaintext,
    });
    await sendPhoto({
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      responseId: 'c2222222-2222-4222-8222-222222222222',
      recipientUserIds: [RECIPIENT_ID],
      plaintext,
    });

    const iv1 = mockRelayPhoto.mock.calls[0][0].iv_b64;
    const iv2 = mockRelayPhoto.mock.calls[1][0].iv_b64;
    expect(iv1).not.toBe(iv2);
  });

  it('throws when plaintext exceeds the size cap', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey());
    const tooBig = new Uint8Array(MAX_PHOTO_BYTES + 1);
    await expect(
      sendPhoto({
        groupId: GROUP_ID,
        challengeId: CHALLENGE_ID,
        responseId: RESPONSE_ID,
        recipientUserIds: [RECIPIENT_ID],
        plaintext: tooBig,
      }),
    ).rejects.toThrow(/exceeds cap/);
    expect(mockRelayPhoto).not.toHaveBeenCalled();
  });

  it('throws cleanly when no group key has been loaded yet', async () => {
    // No storeGroupKey called.
    await expect(
      sendPhoto({
        groupId: GROUP_ID,
        challengeId: CHALLENGE_ID,
        responseId: RESPONSE_ID,
        recipientUserIds: [RECIPIENT_ID],
        plaintext: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow(/handshake required/);
  });

  it('uses the device_id registered in secure-store as sender_device_id', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey());
    mockRelayPhoto.mockResolvedValueOnce({ v: 1, delivered_user_ids: [], queued_user_ids: [] });
    const { device_id } = await getOrCreateDeviceKey();

    await sendPhoto({
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      responseId: RESPONSE_ID,
      recipientUserIds: [RECIPIENT_ID],
      plaintext: new Uint8Array([1]),
    });

    expect(mockRelayPhoto.mock.calls[0][0].sender_device_id).toBe(device_id);
  });
});

describe('photoTransfer.receivePhoto', () => {
  it('decrypts a valid envelope and stores the plaintext', async () => {
    const groupKey = newGroupKey();
    await storeGroupKey(GROUP_ID, groupKey);
    const plaintext = new TextEncoder().encode('round-trip-me');

    // First produce an envelope via sendPhoto (mocked relay)
    mockRelayPhoto.mockResolvedValueOnce({ v: 1, delivered_user_ids: [], queued_user_ids: [] });
    await sendPhoto({
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      responseId: RESPONSE_ID,
      recipientUserIds: [RECIPIENT_ID],
      plaintext,
    });
    const sentBody = mockRelayPhoto.mock.calls[0][0];

    // Simulate the server fanning out: hand the same payload to receivePhoto.
    const ack = await receivePhoto({
      v: 1,
      group_id: GROUP_ID,
      challenge_id: CHALLENGE_ID,
      response_id: RESPONSE_ID,
      sender_user_id: 'sender',
      sender_device_id: sentBody.sender_device_id,
      iv_b64: sentBody.iv_b64,
      auth_tag_b64: sentBody.auth_tag_b64,
      ciphertext_b64: sentBody.ciphertext_b64,
    });

    expect(ack).toEqual({ v: 1, response_id: RESPONSE_ID, ok: true });
    expect(await getReceivedPhoto(RESPONSE_ID)).toEqual(plaintext);
  });

  it('returns KEY_MISSING when the group key is not loaded', async () => {
    const ack = await receivePhoto({
      v: 1,
      group_id: GROUP_ID,
      challenge_id: CHALLENGE_ID,
      response_id: RESPONSE_ID,
      sender_user_id: 'sender',
      sender_device_id: 'dev',
      iv_b64: 'AAAAAAAAAAAAAAAA',
      auth_tag_b64: 'AAAAAAAAAAAAAAAAAAAAAA==',
      ciphertext_b64: 'YWJjZA==',
    });
    expect(ack).toEqual({
      v: 1,
      response_id: RESPONSE_ID,
      ok: false,
      error: 'KEY_MISSING',
    });
  });

  it('returns AUTH_TAG_FAIL on tampered ciphertext', async () => {
    const groupKey = newGroupKey();
    await storeGroupKey(GROUP_ID, groupKey);

    // Produce a valid envelope then flip a bit in the ciphertext.
    mockRelayPhoto.mockResolvedValueOnce({ v: 1, delivered_user_ids: [], queued_user_ids: [] });
    await sendPhoto({
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      responseId: RESPONSE_ID,
      recipientUserIds: [RECIPIENT_ID],
      plaintext: new TextEncoder().encode('intact'),
    });
    const sentBody = mockRelayPhoto.mock.calls[0][0];

    // Replace first base64 char with a different one — guaranteed to flip
    // at least one ciphertext bit.
    const tamperedB64 =
      (sentBody.ciphertext_b64.startsWith('A') ? 'B' : 'A') +
      sentBody.ciphertext_b64.slice(1);

    const ack = await receivePhoto({
      v: 1,
      group_id: GROUP_ID,
      challenge_id: CHALLENGE_ID,
      response_id: RESPONSE_ID,
      sender_user_id: 'sender',
      sender_device_id: sentBody.sender_device_id,
      iv_b64: sentBody.iv_b64,
      auth_tag_b64: sentBody.auth_tag_b64,
      ciphertext_b64: tamperedB64,
    });

    expect(ack).toEqual({
      v: 1,
      response_id: RESPONSE_ID,
      ok: false,
      error: 'AUTH_TAG_FAIL',
    });
  });

  it('is idempotent: re-receiving the same response_id returns ACK without re-decrypting', async () => {
    const groupKey = newGroupKey();
    await storeGroupKey(GROUP_ID, groupKey);
    const plaintext = new Uint8Array([1, 2, 3]);

    mockRelayPhoto.mockResolvedValueOnce({ v: 1, delivered_user_ids: [], queued_user_ids: [] });
    await sendPhoto({
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      responseId: RESPONSE_ID,
      recipientUserIds: [RECIPIENT_ID],
      plaintext,
    });
    const sentBody = mockRelayPhoto.mock.calls[0][0];

    const env = {
      v: 1 as const,
      group_id: GROUP_ID,
      challenge_id: CHALLENGE_ID,
      response_id: RESPONSE_ID,
      sender_user_id: 'sender',
      sender_device_id: sentBody.sender_device_id,
      iv_b64: sentBody.iv_b64,
      auth_tag_b64: sentBody.auth_tag_b64,
      ciphertext_b64: sentBody.ciphertext_b64,
    };
    const ack1 = await receivePhoto(env);
    const ack2 = await receivePhoto(env); // duplicate

    expect(ack1).toEqual({ v: 1, response_id: RESPONSE_ID, ok: true });
    expect(ack2).toEqual({ v: 1, response_id: RESPONSE_ID, ok: true });
  });
});

describe('photoTransfer.respondToPickup', () => {
  it('re-encrypts cached plaintext and POSTs with pickup_id', async () => {
    const groupKey = newGroupKey();
    await storeGroupKey(GROUP_ID, groupKey);
    const plaintext = new TextEncoder().encode('cached plaintext');

    // Prime the sender plaintext cache by running a send.
    mockRelayPhoto.mockResolvedValueOnce({ v: 1, delivered_user_ids: [], queued_user_ids: [] });
    await sendPhoto({
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      responseId: RESPONSE_ID,
      recipientUserIds: [RECIPIENT_ID],
      plaintext,
    });
    // Let putSenderPlaintext fire-and-forget complete.
    await new Promise((r) => setTimeout(r, 0));

    mockRelayPhoto.mockResolvedValueOnce({
      v: 1,
      delivered_user_ids: [RECIPIENT_ID],
      queued_user_ids: [],
    });

    const result = await respondToPickup({
      v: 1,
      response_id: RESPONSE_ID,
      challenge_id: CHALLENGE_ID,
      group_id: GROUP_ID,
      recipient_user_id: RECIPIENT_ID,
      pickup_id: PICKUP_ID,
      challengeId: CHALLENGE_ID,
    });

    expect(result).not.toBeNull();
    expect(result!.delivered).toEqual([RECIPIENT_ID]);

    const pickupBody = mockRelayPhoto.mock.calls[1][0];
    expect(pickupBody.pickup_id).toBe(PICKUP_ID);
    expect(pickupBody.recipient_user_ids).toEqual([RECIPIENT_ID]);
    // Fresh IV vs. the original send (H2): same key + plaintext but new IV.
    expect(pickupBody.iv_b64).not.toBe(mockRelayPhoto.mock.calls[0][0].iv_b64);
  });

  it('returns null when sender plaintext has expired (>7d)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    fsNow.value = Date.now();

    await storeGroupKey(GROUP_ID, newGroupKey());
    mockRelayPhoto.mockResolvedValueOnce({ v: 1, delivered_user_ids: [], queued_user_ids: [] });
    await sendPhoto({
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      responseId: RESPONSE_ID,
      recipientUserIds: [RECIPIENT_ID],
      plaintext: new Uint8Array([1]),
    });
    // Drain microtasks so the fire-and-forget putSenderPlaintext lands.
    // Can't use setTimeout under fake timers — that needs advanceTimersByTime.
    await Promise.resolve();
    await Promise.resolve();

    // Age out the plaintext cache.
    jest.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
    fsNow.value = Date.now();

    const result = await respondToPickup({
      v: 1,
      response_id: RESPONSE_ID,
      challenge_id: CHALLENGE_ID,
      group_id: GROUP_ID,
      recipient_user_id: RECIPIENT_ID,
      pickup_id: PICKUP_ID,
      challengeId: CHALLENGE_ID,
    });

    expect(result).toBeNull();
    // Only the initial send should have hit relayPhoto; pickup short-circuited.
    expect(mockRelayPhoto).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
