/**
 * keyPins — trust-on-first-use pins (a set of accepted keys per member).
 */

import './setup';

import * as SecureStore from 'expo-secure-store';

import { acceptKeyChange, changedKeys, checkPin, wipeAllPins } from '../services/keyPins';
import type { DevicePublicKey } from '../shared/photoProtocol';

const store = new Map<string, string>();
const ME = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';

const key = (userId: string, b64: string): DevicePublicKey => ({
  v: 1,
  user_id: userId,
  device_id: '44444444-4444-4444-8444-444444444444',
  x25519_public_key_b64: b64,
  key_version: 1,
  tombstoned_at: null,
});

beforeEach(() => {
  store.clear();
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => store.get(k) ?? null);
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
    store.set(k, v);
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k: string) => {
    store.delete(k);
  });
});

describe('keyPins', () => {
  it('pins on first sight, then matches or flags a change', async () => {
    expect(await checkPin(BOB, 'key-1')).toBe('new');
    expect(await checkPin(BOB, 'key-1')).toBe('match');
    expect(await checkPin(BOB, 'key-2')).toBe('changed');
    // A change doesn't move the pin.
    expect(await checkPin(BOB, 'key-2')).toBe('changed');
  });

  it('accepting a key adds it, so a member with two phones stops flip-flopping', async () => {
    await checkPin(BOB, 'phone');
    await acceptKeyChange(BOB, 'tablet');

    expect(await checkPin(BOB, 'tablet')).toBe('match');
    expect(await checkPin(BOB, 'phone')).toBe('match');
    expect(await checkPin(BOB, 'third')).toBe('changed');
  });

  it('reads a pin stored before sets as a one-key set', async () => {
    store.set(`blink.e2e.pin.v1.${BOB}`, 'legacy-key');
    expect(await checkPin(BOB, 'legacy-key')).toBe('match');
    await acceptKeyChange(BOB, 'new-key');
    expect(JSON.parse(store.get(`blink.e2e.pin.v1.${BOB}`)!)).toEqual(['legacy-key', 'new-key']);
  });

  it('lists changed members, pinning new ones and skipping our own key', async () => {
    await checkPin(BOB, 'bob-old');
    await checkPin(ME, 'mine-old');

    const changed = await changedKeys([key(BOB, 'bob-new'), key(CAROL, 'carol-1'), key(ME, 'mine-new')], ME);

    expect(changed.map((k) => k.user_id)).toEqual([BOB]);
    expect(await checkPin(CAROL, 'carol-1')).toBe('match');
  });

  it('pins from concurrent first sightings all land, and wiping forgets every one', async () => {
    await Promise.all([checkPin(BOB, 'b'), checkPin(CAROL, 'c'), acceptKeyChange(ME, 'm')]);
    expect(JSON.parse(store.get('blink.e2e.pinIndex.v1')!).sort()).toEqual([BOB, CAROL, ME].sort());

    await wipeAllPins();

    expect([...store.keys()]).toEqual([]);
    expect(await checkPin(BOB, 'other')).toBe('new');
  });
});
