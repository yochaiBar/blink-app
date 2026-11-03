/**
 * photoTransfer tests — the E2E photo flow, relay protocol v2.
 *
 * Exercises the encrypt+relay and receive+decrypt pipelines using REAL noble
 * crypto and the in-memory FS mock. The relay HTTP call is mocked so tests
 * stay hermetic; the wire payload is asserted so the contract with the
 * server's Zod schema can't drift silently, and the associated data is
 * checked by relabelling envelopes.
 */

import './setup';

import * as SecureStore from 'expo-secure-store';

import { sendPhoto, receivePhoto, respondToPickup, MAX_PHOTO_BYTES } from '../services/photoTransfer';
import { newGroupKey, storeGroupKey, loadGroupKey, getOrCreateDeviceKey, GCM_TAG_BYTES } from '../services/groupCrypto';
import { getReceivedPhoto, getSenderPlaintext } from '../services/photoStore';
import type { IncomingPhotoEnvelope, RelayPhotoRequest } from '../shared/photoProtocol';

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

const GROUP_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
const CHALLENGE_ID = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
const RESPONSE_ID = 'c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
const RECIPIENT_ID = 'd1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
const PICKUP_ID = 'e1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
const SENDER_ID = 'f1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';
const OTHER_ID = '01b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e';

const RELAYED = { v: 2, delivered_user_ids: [], queued_user_ids: [] };

const sendArgs = (plaintext: Uint8Array, responseId = RESPONSE_ID) => ({
  groupId: GROUP_ID,
  challengeId: CHALLENGE_ID,
  responseId,
  senderUserId: SENDER_ID,
  plaintext,
});

/** The relay body of the n-th relayPhoto call. */
const relayed = (n = 0): RelayPhotoRequest => mockRelayPhoto.mock.calls[n][0];

/** What the server would emit to a recipient for that relay body. */
function envelopeFor(body: RelayPhotoRequest, overrides: Partial<IncomingPhotoEnvelope> = {}): IncomingPhotoEnvelope {
  return {
    v: 2,
    group_id: GROUP_ID,
    challenge_id: CHALLENGE_ID,
    response_id: body.response_id,
    sender_user_id: SENDER_ID,
    sender_device_id: body.sender_device_id,
    key_version: body.key_version,
    iv_b64: body.iv_b64,
    ciphertext_b64: body.ciphertext_b64,
    ...overrides,
  };
}

/** Store a fresh group key at `version`, send `plaintext` under it, return the relay body. */
async function sendOne(plaintext: Uint8Array, version = 1): Promise<RelayPhotoRequest> {
  await storeGroupKey(GROUP_ID, newGroupKey(), version);
  mockRelayPhoto.mockResolvedValueOnce(RELAYED);
  await sendPhoto(sendArgs(plaintext));
  return relayed();
}

beforeEach(() => {
  fsMemory.clear();
  fsDirs.clear();
  ssMemory.clear();
  mockRelayPhoto.mockReset();
  fsNow.value = Date.now();
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => ssMemory.get(k) ?? null);
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
    ssMemory.set(k, v);
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k: string) => {
    ssMemory.delete(k);
  });
});

describe('photoTransfer.sendPhoto', () => {
  it('encrypts, relays a v2 body with no recipient list, caches plaintext locally', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey(), 3);
    const plaintext = new TextEncoder().encode('hello world');
    mockRelayPhoto.mockResolvedValueOnce({ v: 2, delivered_user_ids: [RECIPIENT_ID], queued_user_ids: [] });

    const result = await sendPhoto(sendArgs(plaintext));

    expect(result).toEqual({ delivered: [RECIPIENT_ID], queued: [] });
    expect(mockRelayPhoto).toHaveBeenCalledTimes(1);
    const body = relayed();
    // The server derives group, challenge and recipients itself.
    expect(Object.keys(body).sort()).toEqual(
      ['ciphertext_b64', 'iv_b64', 'key_version', 'response_id', 'sender_device_id', 'v'].sort(),
    );
    expect(body).toMatchObject({ v: 2, response_id: RESPONSE_ID, key_version: 3 });
    // IV: 12 bytes → 16 base64 chars
    expect(body.iv_b64.length).toBe(16);
    // Ciphertext: plaintext.length + 16 byte tag, base64'd
    expect(body.ciphertext_b64.length).toBe(Math.ceil((plaintext.length + GCM_TAG_BYTES) / 3) * 4);

    // Plaintext cached locally for pickup-on-demand.
    // Give the fire-and-forget putSenderPlaintext a moment to land.
    await new Promise((r) => setTimeout(r, 0));
    expect(await getSenderPlaintext(RESPONSE_ID)).toEqual(plaintext);
  });

  it('produces a fresh IV on every send (H2 — never reused under same key)', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey());
    mockRelayPhoto.mockResolvedValue(RELAYED);
    const plaintext = new TextEncoder().encode('same content');

    await sendPhoto(sendArgs(plaintext));
    await sendPhoto(sendArgs(plaintext, 'c2222222-2222-4222-8222-222222222222'));

    expect(relayed(0).iv_b64).not.toBe(relayed(1).iv_b64);
  });

  it('throws when plaintext exceeds the size cap', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey());
    await expect(sendPhoto(sendArgs(new Uint8Array(MAX_PHOTO_BYTES + 1)))).rejects.toThrow(/exceeds cap/);
    expect(mockRelayPhoto).not.toHaveBeenCalled();
  });

  it('throws cleanly when no group key has been loaded yet', async () => {
    await expect(sendPhoto(sendArgs(new Uint8Array([1, 2, 3])))).rejects.toThrow(/handshake required/);
    expect(mockRelayPhoto).not.toHaveBeenCalled();
  });

  it('uses the device_id registered in secure-store as sender_device_id', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey());
    mockRelayPhoto.mockResolvedValueOnce(RELAYED);
    const { device_id } = await getOrCreateDeviceKey();

    await sendPhoto(sendArgs(new Uint8Array([1])));

    expect(relayed().sender_device_id).toBe(device_id);
  });

  it('surfaces a refused relay (e.g. 409 for a stale key version)', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey());
    mockRelayPhoto.mockRejectedValueOnce(new Error('Group key version mismatch'));
    await expect(sendPhoto(sendArgs(new Uint8Array([1])))).rejects.toThrow(/version mismatch/);
  });
});

describe('photoTransfer.receivePhoto', () => {
  it('decrypts a valid envelope and stores the plaintext', async () => {
    const plaintext = new TextEncoder().encode('round-trip-me');
    const body = await sendOne(plaintext);

    const ack = await receivePhoto(envelopeFor(body));

    expect(ack).toEqual({ v: 2, response_id: RESPONSE_ID, ok: true });
    expect(await getReceivedPhoto(RESPONSE_ID)).toEqual(plaintext);
  });

  it('returns KEY_MISSING when the group key is not loaded', async () => {
    const ack = await receivePhoto({
      v: 2,
      group_id: GROUP_ID,
      challenge_id: CHALLENGE_ID,
      response_id: RESPONSE_ID,
      sender_user_id: SENDER_ID,
      sender_device_id: 'dev',
      key_version: 1,
      iv_b64: 'AAAAAAAAAAAAAAAA',
      ciphertext_b64: 'YWJjZA==',
    });
    expect(ack).toEqual({ v: 2, response_id: RESPONSE_ID, ok: false, error: 'KEY_MISSING' });
  });

  it('returns AUTH_TAG_FAIL on tampered ciphertext', async () => {
    const body = await sendOne(new TextEncoder().encode('intact'));
    // Replace first base64 char with a different one — guaranteed to flip
    // at least one ciphertext bit.
    const tampered = (body.ciphertext_b64.startsWith('A') ? 'B' : 'A') + body.ciphertext_b64.slice(1);

    const ack = await receivePhoto(envelopeFor(body, { ciphertext_b64: tampered }));

    expect(ack).toEqual({ v: 2, response_id: RESPONSE_ID, ok: false, error: 'AUTH_TAG_FAIL' });
  });

  it.each<[string, Partial<IncomingPhotoEnvelope>]>([
    ['another response', { response_id: 'c3333333-3333-4333-8333-333333333333' }],
    ['another sender', { sender_user_id: OTHER_ID }],
    ['another challenge', { challenge_id: OTHER_ID }],
  ])('refuses a photo relabelled as %s (associated data)', async (_label, overrides) => {
    const body = await sendOne(new TextEncoder().encode('bound'));

    const ack = await receivePhoto(envelopeFor(body, overrides));

    expect(ack).toMatchObject({ ok: false, error: 'AUTH_TAG_FAIL' });
    expect(await getReceivedPhoto(overrides.response_id ?? RESPONSE_ID)).toBeNull();
  });

  it('refuses a photo relabelled as another group, even one whose key it holds', async () => {
    const otherGroup = '11111111-1111-4111-8111-111111111111';
    const body = await sendOne(new TextEncoder().encode('bound'));
    // Same key bytes in both groups: only the associated data tells them apart.
    await storeGroupKey(otherGroup, (await loadGroupKey(GROUP_ID))!);

    const ack = await receivePhoto(envelopeFor(body, { group_id: otherGroup }));

    expect(ack).toMatchObject({ ok: false, error: 'AUTH_TAG_FAIL' });
  });

  it('returns VERSION_MISMATCH for a key version it does not hold, or an unknown v', async () => {
    const body = await sendOne(new TextEncoder().encode('v1 photo'), 1);
    await storeGroupKey(GROUP_ID, newGroupKey(), 2); // we've rotated since

    expect(await receivePhoto(envelopeFor(body))).toMatchObject({ ok: false, error: 'VERSION_MISMATCH' });
    const v1 = { ...envelopeFor(body), v: 1 } as unknown as IncomingPhotoEnvelope;
    expect(await receivePhoto(v1)).toMatchObject({ ok: false, error: 'VERSION_MISMATCH' });
  });

  it('is idempotent: re-receiving the same response_id returns ACK without re-decrypting', async () => {
    const body = await sendOne(new Uint8Array([1, 2, 3]));
    const env = envelopeFor(body);

    expect(await receivePhoto(env)).toEqual({ v: 2, response_id: RESPONSE_ID, ok: true });
    expect(await receivePhoto(env)).toEqual({ v: 2, response_id: RESPONSE_ID, ok: true });
  });
});

describe('photoTransfer.respondToPickup', () => {
  const pickup = {
    v: 2 as const,
    response_id: RESPONSE_ID,
    challenge_id: CHALLENGE_ID,
    group_id: GROUP_ID,
    recipient_user_id: RECIPIENT_ID,
    pickup_id: PICKUP_ID,
  };

  it('re-encrypts cached plaintext and POSTs with pickup_id; the recipient can decrypt it', async () => {
    const plaintext = new TextEncoder().encode('cached plaintext');
    await sendOne(plaintext);
    // Let putSenderPlaintext fire-and-forget complete.
    await new Promise((r) => setTimeout(r, 0));
    mockRelayPhoto.mockResolvedValueOnce({ v: 2, delivered_user_ids: [RECIPIENT_ID], queued_user_ids: [] });

    const result = await respondToPickup(pickup, SENDER_ID);

    expect(result).toEqual({ delivered: [RECIPIENT_ID], queued: [] });
    const pickupBody = relayed(1);
    expect(pickupBody).toMatchObject({ v: 2, response_id: RESPONSE_ID, pickup_id: PICKUP_ID, key_version: 1 });
    expect(pickupBody).not.toHaveProperty('recipient_user_ids');
    // Fresh IV vs. the original send (H2): same key + plaintext but new IV.
    expect(pickupBody.iv_b64).not.toBe(relayed(0).iv_b64);
    expect(await receivePhoto(envelopeFor(pickupBody))).toMatchObject({ ok: true });
  });

  it('returns null when sender plaintext has expired (>7d)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    fsNow.value = Date.now();

    await sendOne(new Uint8Array([1]));
    // Drain microtasks so the fire-and-forget putSenderPlaintext lands.
    // Can't use setTimeout under fake timers — that needs advanceTimersByTime.
    await Promise.resolve();
    await Promise.resolve();

    // Age out the plaintext cache.
    jest.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
    fsNow.value = Date.now();

    const result = await respondToPickup(pickup, SENDER_ID);

    expect(result).toBeNull();
    // Only the initial send should have hit relayPhoto; pickup short-circuited.
    expect(mockRelayPhoto).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
