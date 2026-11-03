import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserProfile } from '@/types';
import { api, getUserStats } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { apiUserToProfile } from '@/utils/adapters';
import { queryKeys } from '@/utils/queryKeys';

export function useProfile(groupCount: number) {
  const authUser = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const queryClient = useQueryClient();

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
      bio: '',
      totalSnaps: 0,
      longestStreak: 0,
      groupCount: 0,
      joinDate: new Date().toISOString(),
    };
  }, [authUser, groupCount, statsQuery.data]);

  const displayName = userProfile.name?.split(' ')[0] || 'You';

  const updateProfile = useCallback(
    async (updates: Partial<Pick<UserProfile, 'name' | 'bio'>>) => {
      const authStore = useAuthStore.getState();

      try {
        const payload: Record<string, unknown> = {};
        if (updates.name !== undefined) payload.display_name = updates.name;
        if (updates.bio !== undefined) payload.bio = updates.bio;

        if (Object.keys(payload).length > 0) {
          const updatedUser = await api<{
            id: string;
            display_name: string | null;
            bio: string | null;
          }>('/auth/profile', {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });

          // Update local auth store with the server response
          if (updatedUser) {
            if (updatedUser.display_name !== undefined) {
              authStore.updateName(updatedUser.display_name ?? '');
            }
            if (updatedUser.bio !== undefined) {
              authStore.updateBio(updatedUser.bio ?? '');
            }
          }
        } else if (updates.name && authStore.user) {
          // Fallback: at least update name locally if no server call was needed
          authStore.updateName(updates.name);
        }

        // Invalidate queries so the new name shows everywhere
        queryClient.invalidateQueries({ queryKey: queryKeys.user.stats });
        queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Could not save profile changes.';
        Alert.alert('Profile Update Failed', message);
        throw err;
      }
    },
    [queryClient],
  );

  return {
    userProfile,
    displayName,
    updateProfile,
  };
}
