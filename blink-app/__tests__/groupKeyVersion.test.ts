/**
 * Group-key version storage — the mechanism that lets the recovery flow
 * resolve key rotations ("higher version wins") instead of the old
 * refuse-any-conflict behaviour that would have bricked regeneration.
 */
import './setup';

import * as SecureStore from 'expo-secure-store';
import {
  storeGroupKey,
  loadGroupKey,
  loadGroupKeyVersion,
  deleteGroupKey,
  newGroupKey,
  getOrCreateDeviceKey,
  wipeAllGroupKeys,
} from '../services/groupCrypto';

const GROUP_ID = 'group-abc';

// Back the mocked SecureStore with a real in-memory map for these tests.
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) =>
    store.has(k) ? store.get(k)! : null,
  );
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
    store.set(k, v);
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k: string) => {
    store.delete(k);
  });
});

describe('groupCrypto — group key versioning', () => {
  it('defaults a stored key to version 1', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey());
    expect(await loadGroupKeyVersion(GROUP_ID)).toBe(1);
  });

  it('persists and reads back an explicit version', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey(), 5);
    expect(await loadGroupKeyVersion(GROUP_ID)).toBe(5);
  });

  it('returns 0 when no key is stored (distinguishes missing from stale)', async () => {
    expect(await loadGroupKeyVersion('never-stored')).toBe(0);
  });

  it('treats a key with no version record as version 1 (legacy install)', async () => {
    // Simulate a pre-versioning install: key present, version absent.
    store.set('blink.e2e.groupKey.v1.' + GROUP_ID, 'AAAA');
    expect(await loadGroupKeyVersion(GROUP_ID)).toBe(1);
  });

  it('deleteGroupKey clears both key and version', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey(), 3);
    await deleteGroupKey(GROUP_ID);
    expect(await loadGroupKey(GROUP_ID)).toBeNull();
    expect(await loadGroupKeyVersion(GROUP_ID)).toBe(0);
  });

  it('overwriting bumps the stored version (rotation)', async () => {
    await storeGroupKey(GROUP_ID, newGroupKey(), 1);
    await storeGroupKey(GROUP_ID, newGroupKey(), 2);
    expect(await loadGroupKeyVersion(GROUP_ID)).toBe(2);
  });
});

describe('groupCrypto — wiping and the device key', () => {
  it('wipes every group key it stored, even ones stored concurrently', async () => {
    await Promise.all(['g1', 'g2', 'g3'].map((id, i) => storeGroupKey(id, newGroupKey(), i + 1)));
    await deleteGroupKey('g2');

    await wipeAllGroupKeys();

    expect([...store.keys()]).toEqual([]);
    expect(await loadGroupKey('g1')).toBeNull();
  });

  it('racing first calls share one device keypair', async () => {
    const [a, b] = await Promise.all([getOrCreateDeviceKey(), getOrCreateDeviceKey()]);

    expect(a.device_id).toBe(b.device_id);
    expect(
      (SecureStore.setItemAsync as jest.Mock).mock.calls.filter(([k]) => k === 'blink.e2e.deviceId.v1'),
    ).toHaveLength(1);
    expect((await getOrCreateDeviceKey()).device_id).toBe(a.device_id);
  });
});
