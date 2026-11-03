/**
 * keyTransfer tests — the group-key courier handshake, protocol v2.
 *
 * Two simulated devices (separate secure-store backings) run the REAL noble
 * crypto; the HTTP calls are mocked so the wire bodies can be asserted and
 * the server's confirm answer controlled. Covers the joiner's accept rule.
 */

import './setup';

import * as SecureStore from 'expo-secure-store';

import { acceptKeyshareEnvelope, mintGroupKey, respondToKeyshareRequest } from '../services/keyTransfer';
import { acceptKeyChange } from '../services/keyPins';
import {
  bytesToB64,
  getOrCreateDeviceKey,
  loadGroupKey,
  loadGroupKeyVersion,
  newGroupKey,
  storeGroupKey,
} from '../services/groupCrypto';
import type { KeyshareDeliverRequest, KeyshareEnvelope, KeyshareRequest } from '../shared/photoProtocol';

const mockDeliverKeyshare = jest.fn();
const mockConfirmGroupKey = jest.fn();
jest.mock('@/services/api', () => ({
  deliverKeyshare: (...args: unknown[]) => mockDeliverKeyshare(...args),
  confirmGroupKey: (...args: unknown[]) => mockConfirmGroupKey(...args),
}));

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const ALICE_ID = '22222222-2222-4222-8222-222222222222';
const BOB_ID = '33333333-3333-4333-8333-333333333333';
const PENDING_ID = '44444444-4444-4444-8444-444444444444';

const alicePhone = new Map<string, string>();
const bobPhone = new Map<string, string>();
let device = alicePhone;
const on = (store: Map<string, string>) => {
  device = store;
};

beforeEach(() => {
  alicePhone.clear();
  bobPhone.clear();
  on(alicePhone);
  mockDeliverKeyshare.mockReset().mockResolvedValue({ v: 2, delivered: true });
  mockConfirmGroupKey.mockReset().mockImplementation(async (b: { key_version: number }) => ({ v: 2, ...b }));
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => device.get(k) ?? null);
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
    device.set(k, v);
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k: string) => {
    device.delete(k);
  });
});

/** What the server would send Alice for Bob's phone. */
async function requestForBob(keyVersion = 1, deviceIdOverride?: string): Promise<KeyshareRequest> {
  on(bobPhone);
  const bob = await getOrCreateDeviceKey();
  on(alicePhone);
  return {
    v: 2,
    pending_join_id: PENDING_ID,
    group_id: GROUP_ID,
    joiner_user_id: BOB_ID,
    joiner_device_id: deviceIdOverride ?? bob.device_id,
    joiner_x25519_public_key_b64: bytesToB64(bob.publicKey),
    key_version: keyVersion,
  };
}

/** What the server would forward to Bob's phone for that delivery. */
function envelopeFrom(body: KeyshareDeliverRequest): KeyshareEnvelope {
  return {
    v: 2,
    pending_join_id: body.pending_join_id,
    group_id: GROUP_ID,
    from_user_id: ALICE_ID,
    from_device_id: body.from_device_id,
    key_version: body.key_version,
    ephemeral_public_key_b64: body.ephemeral_public_key_b64,
    iv_b64: body.iv_b64,
    ciphertext_b64: body.ciphertext_b64,
  };
}

/** Alice holds `key` at `version` and couriers it to Bob's phone; returns the envelope Bob gets. */
async function aliceSendsBob(key: Uint8Array, version = 1): Promise<KeyshareEnvelope> {
  const request = await requestForBob(version);
  on(alicePhone);
  await storeGroupKey(GROUP_ID, key, version);
  expect(await respondToKeyshareRequest(request)).toBe('delivered');
  on(bobPhone);
  return envelopeFrom(mockDeliverKeyshare.mock.calls[mockDeliverKeyshare.mock.calls.length - 1][0]);
}

describe('keyTransfer — courier', () => {
  it('delivers a v2 body for the requested version, and the joiner gets the same key', async () => {
    const key = newGroupKey();
    const envelope = await aliceSendsBob(key);

    const body = mockDeliverKeyshare.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(
      [
        'ciphertext_b64',
        'ephemeral_public_key_b64',
        'from_device_id',
        'iv_b64',
        'key_version',
        'pending_join_id',
        'v',
      ].sort(),
    );
    expect(body).toMatchObject({ v: 2, pending_join_id: PENDING_ID, key_version: 1 });

    expect(await acceptKeyshareEnvelope(envelope, BOB_ID)).toBe('stored');
    expect(mockConfirmGroupKey).toHaveBeenCalledWith({ group_id: GROUP_ID, key_version: 1 });
    expect(await loadGroupKey(GROUP_ID)).toEqual(key);
    expect(await loadGroupKeyVersion(GROUP_ID)).toBe(1);
  });

  it('declines when it does not hold exactly the requested version', async () => {
    const asksForV2 = await requestForBob(2);
    on(alicePhone);
    expect(await respondToKeyshareRequest(asksForV2)).toBe('no_key'); // no key at all
    await storeGroupKey(GROUP_ID, newGroupKey(), 1);
    expect(await respondToKeyshareRequest(asksForV2)).toBe('no_key'); // stale key
    expect(mockDeliverKeyshare).not.toHaveBeenCalled();
  });
});

describe('keyTransfer — courier pins (TOFU)', () => {
  it('pins the joiner’s key on first sight and refuses a changed one until accepted', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey(), 1);
    const first = await requestForBob();
    expect(await respondToKeyshareRequest(first)).toBe('delivered');

    // Bob reinstalls (or the server swaps in another key): same user, new key.
    on(bobPhone);
    bobPhone.clear();
    const swapped = await requestForBob();
    expect(swapped.joiner_x25519_public_key_b64).not.toBe(first.joiner_x25519_public_key_b64);
    expect(await respondToKeyshareRequest(swapped)).toBe('key_changed');
    expect(mockDeliverKeyshare).toHaveBeenCalledTimes(1);

    await acceptKeyChange(BOB_ID, swapped.joiner_x25519_public_key_b64);
    expect(await respondToKeyshareRequest(swapped)).toBe('delivered');
  });
});

describe('keyTransfer — joiner accept rule', () => {
  it('cannot open an envelope made for another of its devices', async () => {
    const request = await requestForBob(1, '55555555-5555-4555-8555-555555555555');
    await storeGroupKey(GROUP_ID, newGroupKey(), 1);
    await respondToKeyshareRequest(request);
    on(bobPhone);

    expect(await acceptKeyshareEnvelope(envelopeFrom(mockDeliverKeyshare.mock.calls[0][0]), BOB_ID)).toBe(
      'undecryptable',
    );
    expect(mockConfirmGroupKey).not.toHaveBeenCalled();
    expect(await loadGroupKey(GROUP_ID)).toBeNull();
  });

  it('ignores a key older than the one it holds', async () => {
    const envelope = await aliceSendsBob(newGroupKey(), 1);
    const mine = newGroupKey();
    await storeGroupKey(GROUP_ID, mine, 2);

    expect(await acceptKeyshareEnvelope(envelope, BOB_ID)).toBe('stale');
    expect(mockConfirmGroupKey).not.toHaveBeenCalled();
    expect(await loadGroupKey(GROUP_ID)).toEqual(mine);
  });

  it('refuses a different key at the version it holds', async () => {
    const envelope = await aliceSendsBob(newGroupKey(), 1);
    const mine = newGroupKey();
    await storeGroupKey(GROUP_ID, mine, 1);

    expect(await acceptKeyshareEnvelope(envelope, BOB_ID)).toBe('conflict');
    expect(await loadGroupKey(GROUP_ID)).toEqual(mine);
  });

  it('re-confirms the key it already holds without rewriting it', async () => {
    const key = newGroupKey();
    const envelope = await aliceSendsBob(key, 1);
    await storeGroupKey(GROUP_ID, key, 1);

    expect(await acceptKeyshareEnvelope(envelope, BOB_ID)).toBe('unchanged');
    expect(mockConfirmGroupKey).toHaveBeenCalledTimes(1);
  });

  it('takes a rotated key at a higher version', async () => {
    const rotated = newGroupKey();
    const envelope = await aliceSendsBob(rotated, 2);
    await storeGroupKey(GROUP_ID, newGroupKey(), 1);

    expect(await acceptKeyshareEnvelope(envelope, BOB_ID)).toBe('stored');
    expect(await loadGroupKey(GROUP_ID)).toEqual(rotated);
    expect(await loadGroupKeyVersion(GROUP_ID)).toBe(2);
  });

  it('keeps nothing when the server says the version is no longer current', async () => {
    const envelope = await aliceSendsBob(newGroupKey(), 1);
    mockConfirmGroupKey.mockRejectedValueOnce(new Error('Group key version mismatch'));

    expect(await acceptKeyshareEnvelope(envelope, BOB_ID)).toBe('refused');
    expect(await loadGroupKey(GROUP_ID)).toBeNull();
  });
});

describe('keyTransfer — mint', () => {
  it('stores a fresh key at the given version and confirms it', async () => {
    await mintGroupKey(GROUP_ID, 3);

    expect(await loadGroupKey(GROUP_ID)).toHaveLength(32);
    expect(await loadGroupKeyVersion(GROUP_ID)).toBe(3);
    expect(mockConfirmGroupKey).toHaveBeenCalledWith({ group_id: GROUP_ID, key_version: 3 });
  });
});
