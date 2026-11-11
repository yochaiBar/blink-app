/**
 * useGroups — the groups list, including when the demo group is listed.
 */

import { flush, renderHook } from './support/renderHook';
import { useGroups } from '../hooks/useGroups';
import { demoSource } from '../services/demoSource';
import { useOnboardingStore } from '../stores/onboardingStore';

// iOS, so onboarding state persists through the (mocked) SecureStore.
jest.mock('react-native', () => ({ Alert: { alert: jest.fn() }, Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('react-native-get-random-values', () => ({}));

const mockGroupsFromServer: { current: unknown[] } = { current: [] };
const mockApi = jest.fn(async (path: string, init?: { method?: string }) => {
  if (path === '/groups' && init?.method === 'POST') return { id: 'g-new', group_key_version: 1 };
  return path === '/groups' ? mockGroupsFromServer.current : null;
});
jest.mock('@/services/api', () => ({
  api: (path: string, init?: { method?: string }) => mockApi(path, init),
  confirmGroupKey: jest.fn(),
}));
jest.mock('@/services/keyTransfer', () => ({ mintGroupKey: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (select: (s: { isAuthenticated: boolean }) => unknown) => select({ isAuthenticated: true }),
}));

beforeEach(() => {
  mockGroupsFromServer.current = [];
  useOnboardingStore.setState({ tourComplete: false, demoDismissed: false, demoChallengeCompleted: false });
});

describe('useGroups — the demo group', () => {
  it('is still listed after the tour ends, while the user has no real group', async () => {
    useOnboardingStore.setState({ tourComplete: true });

    const { result } = await renderHook(() => useGroups());
    await flush();

    expect(result.current.shouldShowDemoGroup).toBe(true);
    expect(result.current.groups.map((g) => g.id)).toEqual([demoSource.groupId]);
  });
});

describe('useGroups — creating a group', () => {
  it("sends the device's time zone, so the daily challenge runs in local hours", async () => {
    const { result } = await renderHook(() => useGroups());

    await result.current.createGroup({ name: 'Roommates', emoji: '🏠' } as never);

    const [, init] = mockApi.mock.calls.find(([path, i]) => path === '/groups' && i?.method === 'POST')!;
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      name: 'Roommates',
      icon: '🏠',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });
});
