/**
 * useGroups — the groups list, including when the demo group is listed.
 */

import { flush, renderHook } from './support/renderHook';
import { useGroups } from '../hooks/useGroups';
import { demoSource } from '../services/demoSource';
import { useOnboardingStore } from '../stores/onboardingStore';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() }, Platform: { OS: 'web' } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('react-native-get-random-values', () => ({}));

const mockGroupsFromServer: { current: unknown[] } = { current: [] };
jest.mock('@/services/api', () => ({
  api: async (path: string) => (path === '/groups' ? mockGroupsFromServer.current : null),
  confirmGroupKey: jest.fn(),
}));
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
