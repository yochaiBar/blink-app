/**
 * groupKeySync — reconcile each group's local key with the server, at most
 * once a minute per group.
 */

import './setup';

import { GROUP_KEY_SYNC_INTERVAL_MS, resetGroupKeySync, syncGroupKeys } from '../services/groupKeySync';

const mockConfirmGroupKey = jest.fn();
const mockRequestKeyshare = jest.fn();
const mockMintGroupKey = jest.fn();
const mockLoadGroupKey = jest.fn();
const mockLoadGroupKeyVersion = jest.fn();
jest.mock('@/services/api', () => ({
  confirmGroupKey: (...a: unknown[]) => mockConfirmGroupKey(...a),
  requestKeyshare: (...a: unknown[]) => mockRequestKeyshare(...a),
}));
jest.mock('@/services/keyTransfer', () => ({ mintGroupKey: (...a: unknown[]) => mockMintGroupKey(...a) }));
jest.mock('@/services/groupCrypto', () => ({
  getOrCreateDeviceKey: async () => ({ device_id: 'dev-1' }),
  loadGroupKey: (...a: unknown[]) => mockLoadGroupKey(...a),
  loadGroupKeyVersion: (...a: unknown[]) => mockLoadGroupKeyVersion(...a),
}));

const group = (id: string, memberCount: number, groupKeyVersion = 1) => ({
  id,
  memberCount,
  members: [],
  groupKeyVersion,
});
const KEY = new Uint8Array(32);

/** Local state per group: [key held?, local version]. */
function local(state: Record<string, [boolean, number]>) {
  mockLoadGroupKey.mockImplementation(async (id: string) => (state[id]?.[0] ? KEY : null));
  mockLoadGroupKeyVersion.mockImplementation(async (id: string) => state[id]?.[1] ?? 0);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetGroupKeySync();
  for (const m of [mockConfirmGroupKey, mockRequestKeyshare, mockMintGroupKey]) m.mockResolvedValue(undefined);
});

describe('syncGroupKeys', () => {
  it('mints for a solo group, asks for a missing or stale key, re-confirms a current one', async () => {
    local({ current: [true, 2], stale: [true, 1] });

    await syncGroupKeys([group('solo', 1), group('missing', 3), group('stale', 3, 2), group('current', 3, 2)]);

    expect(mockMintGroupKey).toHaveBeenCalledWith('solo', 1);
    expect(mockRequestKeyshare.mock.calls).toEqual([
      [{ group_id: 'missing', device_id: 'dev-1' }],
      [{ group_id: 'stale', device_id: 'dev-1' }],
    ]);
    expect(mockConfirmGroupKey).toHaveBeenCalledWith({ group_id: 'current', key_version: 2 });
  });

  it('skips a group synced in the last minute; a failed sync retries on the next pass', async () => {
    local({ g1: [true, 1] });
    const t0 = 1_000_000;
    mockConfirmGroupKey.mockRejectedValueOnce(new Error('offline'));

    await syncGroupKeys([group('g1', 3), group('g2', 3)], t0);
    await syncGroupKeys([group('g1', 3), group('g2', 3)], t0 + 1000);

    // g1 failed and was tried again; g2 succeeded and was skipped.
    expect(mockConfirmGroupKey).toHaveBeenCalledTimes(2);
    expect(mockRequestKeyshare).toHaveBeenCalledTimes(1);

    await syncGroupKeys([group('g1', 3), group('g2', 3)], t0 + GROUP_KEY_SYNC_INTERVAL_MS + 1);
    expect(mockRequestKeyshare).toHaveBeenCalledTimes(2);
  });
});
