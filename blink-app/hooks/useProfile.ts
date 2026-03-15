import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { UserProfile } from '@/types';
import { api, getUserStats } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { apiUserToProfile } from '@/utils/adapters';
import { queryKeys } from '@/utils/queryKeys';

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop';

export function useProfile(groupCount: number) {
  const authUser = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const statsQuery = useQuery({
    queryKey: queryKeys.user.stats,
    queryFn: getUserStats,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const userProfile: UserProfile = useMemo(() => {
    const stats = statsQuery.data;
    if (authUser) {
      return {
        ...apiUserToProfile(authUser),
        totalSnaps: stats?.total_snaps ?? 0,
        longestStreak: stats?.longest_streak ?? 0,
        groupCount,
      };
    }
    return {
      id: '',
      name: '',
      username: '',
      avatar: DEFAULT_AVATAR,
      bio: '',
      totalSnaps: 0,
      longestStreak: 0,
      groupCount: 0,
      joinDate: new Date().toISOString(),
      notificationsEnabled: true,
      privacyMode: 'everyone' as const,
    };
  }, [authUser, groupCount, statsQuery.data]);

  const displayName = userProfile.name?.split(' ')[0] || 'You';

  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    const authStore = useAuthStore.getState();
    if (updates.name && authStore.user) {
      authStore.updateName(updates.name);
    }
    try {
      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.display_name = updates.name;
      if (updates.avatar !== undefined && updates.avatar.startsWith('http')) {
        payload.avatar_url = updates.avatar;
      }
      if (Object.keys(payload).length > 0) {
        await api('/auth/profile', {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not save profile changes.';
      Alert.alert('Profile Update Failed', message);
      throw err;
    }
  }, []);

  return {
    userProfile,
    displayName,
    updateProfile,
  };
}
