/**
 * Hook tests (renderHook + QueryClient): useGroupKeySync, useInviteReplay,
 * and useSubmitSnap keeping a photo whose relay failed.
 */

// ── Shared mocks ─────────────────────────────────────────────────
import { Alert } from 'react-native';
import { flush, renderHook } from './support/renderHook';
import { useGroupKeySync } from '../hooks/useGroupKeySync';
import { useInviteReplay } from '../hooks/useInviteReplay';
import { useSubmitSnap } from '../hooks/useSubmitSnap';
import { usePendingInvite } from '../stores/pendingInviteStore';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() }, Platform: { OS: 'web' } }));
jest.mock('expo-haptics', () => ({}));

const mockAuth = {
  isLoading: false,
  isAuthenticated: true,
  user: { id: 'me', display_name: 'Me' } as { id: string; display_name: string | null } | null,
};
jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign((select: (s: typeof mockAuth) => unknown) => select(mockAuth), {
    getState: () => mockAuth,
  }),
}));

const mockSyncGroupKeys = jest.fn();
const mockResetGroupKeySync = jest.fn();
jest.mock('@/services/groupKeySync', () => ({
  syncGroupKeys: (...a: unknown[]) => mockSyncGroupKeys(...a),
  resetGroupKeySync: () => mockResetGroupKeySync(),
}));
const mockFetchGroups = jest.fn();
jest.mock('@/hooks/useGroups', () => ({ fetchGroups: () => mockFetchGroups() }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockApi = jest.fn();
const mockRequestKeyshare = jest.fn();
jest.mock('@/services/api', () => ({
  api: (...a: unknown[]) => mockApi(...a),
  requestKeyshare: (...a: unknown[]) => mockRequestKeyshare(...a),
}));
const mockSendPhoto = jest.fn();
jest.mock('@/services/photoTransfer', () => ({ sendPhoto: (...a: unknown[]) => mockSendPhoto(...a) }));
const mockQueueRelayRetry = jest.fn();
jest.mock('@/services/relayRetry', () => ({ queueRelayRetry: (...a: unknown[]) => mockQueueRelayRetry(...a) }));
jest.mock('@/services/photoStore', () => ({ putReceivedPhoto: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/demoSource', () => ({ isDemoGroup: () => false, demoSource: {} }));
jest.mock('@/services/groupCrypto', () => ({
  b64ToBytes: () => new Uint8Array([1, 2, 3]),
  getOrCreateDeviceKey: async () => ({ device_id: 'dev-1' }),
}));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: async () => 'AQID',
}));

const groups = [{ id: 'g1', memberCount: 2, members: [], groupKeyVersion: 1 }];

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockAuth, { isLoading: false, isAuthenticated: true, user: { id: 'me', display_name: 'Me' } });
  mockFetchGroups.mockResolvedValue(groups);
  mockSyncGroupKeys.mockResolvedValue(undefined);
  mockQueueRelayRetry.mockResolvedValue(undefined);
  mockRequestKeyshare.mockResolvedValue({ v: 2, enqueued: true, couriers_notified: 0 });
  usePendingInvite.getState().clear();
});

describe('useGroupKeySync', () => {
  it('syncs keys for the loaded groups while signed in, and forgets its state when signed out', async () => {
    const { rerender } = await renderHook(() => useGroupKeySync());
    await flush();
    expect(mockSyncGroupKeys).toHaveBeenCalledWith(groups);

    mockAuth.isAuthenticated = false;
    await rerender();
    expect(mockResetGroupKeySync).toHaveBeenCalled();
  });

  it('fetches nothing while signed out', async () => {
    mockAuth.isAuthenticated = false;
    await renderHook(() => useGroupKeySync());
    await flush();
    expect(mockFetchGroups).not.toHaveBeenCalled();
    expect(mockSyncGroupKeys).not.toHaveBeenCalled();
  });
});

describe('useInviteReplay', () => {
  it('waits for sign-in and the end of onboarding, then opens the invite once', async () => {
    usePendingInvite.getState().setCode('ABC123');
    mockAuth.isAuthenticated = false;
    let inOnboarding = true;
    const { rerender } = await renderHook(() => useInviteReplay(inOnboarding));
    expect(mockPush).not.toHaveBeenCalled();

    mockAuth.isAuthenticated = true;
    await rerender(); // signed in, still onboarding
    expect(mockPush).not.toHaveBeenCalled();

    inOnboarding = false;
    await rerender();
    await rerender();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/join-group', params: { code: 'ABC123' } });
    expect(usePendingInvite.getState().code).toBeNull();
  });
});

describe('useSubmitSnap', () => {
  function arrangeServer() {
    mockApi.mockImplementation(async (path: string) => {
      if (path.endsWith('/challenges/active')) return { id: 'c1' };
      if (path.endsWith('/respond')) return { id: 'r1' };
      throw new Error(`unexpected ${path}`);
    });
  }

  it('keeps a photo whose relay failed for a later retry, without bothering the user', async () => {
    arrangeServer();
    mockSendPhoto.mockRejectedValueOnce(new Error('Network request failed'));
    const { result } = await renderHook(() => useSubmitSnap());

    await result.current.submitSnap('g1', 'file:///snap.jpg');

    expect(mockQueueRelayRetry).toHaveBeenCalledWith({
      groupId: 'g1',
      challengeId: 'c1',
      responseId: 'r1',
      senderUserId: 'me',
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('queues it too when the group key is missing, and asks for the key', async () => {
    arrangeServer();
    mockSendPhoto.mockRejectedValueOnce(new Error('photoTransfer.sendPhoto: no group key for g1; handshake required'));
    const { result } = await renderHook(() => useSubmitSnap());

    await expect(result.current.submitSnap('g1', 'file:///snap.jpg')).rejects.toThrow('no group key');
    await flush();

    expect(mockQueueRelayRetry).toHaveBeenCalledTimes(1);
    expect(mockRequestKeyshare).toHaveBeenCalledWith({ group_id: 'g1', device_id: 'dev-1' });
    expect(Alert.alert).toHaveBeenCalledWith('Setup Required', expect.any(String), expect.any(Array));
  });
});
