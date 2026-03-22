import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserProfile } from '@/types';
import { api, getUserStats, uploadAvatar } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { apiUserToProfile } from '@/utils/adapters';
import { queryKeys } from '@/utils/queryKeys';

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop';

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

    try {
      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.display_name = updates.name;
      if (updates.bio !== undefined) payload.bio = updates.bio;

      // Handle avatar: upload to S3 if it is a local file URI, then send the S3 URL
      if (updates.avatar !== undefined) {
        let avatarUrl = updates.avatar;

        // If the avatar is a local file URI (not already an http URL), upload it first
        if (avatarUrl && !avatarUrl.startsWith('http')) {
          avatarUrl = await uploadAvatar(avatarUrl);
        }

        // Only send avatar_url if it is a valid http URL (S3 or dev fallback)
        if (avatarUrl && avatarUrl.startsWith('http')) {
          payload.avatar_url = avatarUrl;
        }
      }

      if (Object.keys(payload).length > 0) {
        const updatedUser = await api<{
          id: string;
          phone_number: string;
          display_name: string | null;
          avatar_url: string | null;
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
          if (updatedUser.avatar_url !== undefined) {
            authStore.updateAvatar(updatedUser.avatar_url ?? '');
          }
          if (updatedUser.bio !== undefined) {
            authStore.updateBio(updatedUser.bio ?? '');
          }
        }
      } else if (updates.name && authStore.user) {
        // Fallback: at least update name locally if no server call was needed
        authStore.updateName(updates.name);
      }

      // Invalidate queries so avatar updates propagate everywhere
      queryClient.invalidateQueries({ queryKey: queryKeys.user.stats });
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not save profile changes.';
      Alert.alert('Profile Update Failed', message);
      throw err;
    }
  }, [queryClient]);

  return {
    userProfile,
    displayName,
    updateProfile,
  };
}
