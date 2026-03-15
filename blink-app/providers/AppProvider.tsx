import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { useAuthStore } from '@/stores/authStore';
import { useGroups } from '@/hooks/useGroups';
import { useActivity } from '@/hooks/useActivity';
import { useNotifications } from '@/hooks/useNotifications';
import { useProfile } from '@/hooks/useProfile';
import { useSubmitSnap } from '@/hooks/useSubmitSnap';
import { usePromptResponse } from '@/hooks/usePromptResponse';
import { useReactions } from '@/hooks/useReactions';

export const [AppProvider, useApp] = createContextHook(() => {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authLogout = useAuthStore((s) => s.logout);

  // ── Domain hooks ──
  const {
    groups,
    shouldShowDemoGroup,
    isLoadingGroups,
    isDataLoaded,
    isRefreshing,
    createGroup,
    joinGroup,
    refreshGroups,
  } = useGroups();

  const {
    activity,
    addActivityItem,
    isActivityLoading,
    isActivityError,
    refetchActivity,
  } = useActivity();

  const {
    notifications,
    unreadNotificationCount,
    markNotificationsRead,
    isNotificationsLoading,
    isNotificationsError,
    refetchNotifications,
  } = useNotifications();

  const { userProfile: user, updateProfile } = useProfile(groups.length);

  const { submitSnap: rawSubmitSnap } = useSubmitSnap();

  const { addReaction } = useReactions();

  const { respondToPrompt, getPromptResponses } = usePromptResponse(user);

  // ── Wrap submitSnap to also track activity (bridges two hooks) ──
  const submitSnap = useCallback(
    async (groupId: string, imageUri?: string) => {
      await rawSubmitSnap(groupId, imageUri);
      const group = groups.find((g) => g.id === groupId);
      addActivityItem('snap', group?.name ?? 'Group', groupId, 'submitted a snap', undefined, {
        id: user.id || 'self',
        name: user.name?.split(' ')[0] || 'You',
        avatar: user.avatar,
      });
    },
    [rawSubmitSnap, groups, addActivityItem, user.id, user.name, user.avatar],
  );

  // ── Wrap createGroup to also track activity ──
  const addGroup = useCallback(
    async (group: Parameters<typeof createGroup>[0]) => {
      await createGroup(group);
      addActivityItem('join', group.name, group.id, 'created a new group', undefined, {
        id: user.id || 'self',
        name: user.name?.split(' ')[0] || 'You',
        avatar: user.avatar,
      });
    },
    [createGroup, addActivityItem, user.id, user.name, user.avatar],
  );

  // ── Wrap joinGroup to also track activity ──
  const joinGroupWithActivity = useCallback(
    async (code: string) => {
      const result = await joinGroup(code);
      if (result.success && result.groupId) {
        addActivityItem('join', result.groupName ?? 'Group', result.groupId, 'joined the group', undefined, {
          id: user.id || 'self',
          name: user.name?.split(' ')[0] || 'You',
          avatar: user.avatar,
        });
      }
      return result;
    },
    [joinGroup, addActivityItem, user.id, user.name, user.avatar],
  );

  // ── isOnboarded = isAuthenticated ──
  const isOnboarded = isAuthenticated;

  // ── Logout ──
  const logout = useCallback(async () => {
    await authLogout();
    queryClient.clear();
  }, [authLogout, queryClient]);

  return {
    groups,
    shouldShowDemoGroup,
    activity,
    user,
    notifications,
    unreadNotificationCount,
    isOnboarded,
    isDataLoaded,
    isLoading: isLoadingGroups,
    isRefreshing,
    isActivityLoading,
    isActivityError,
    refetchActivity,
    isNotificationsLoading,
    isNotificationsError,
    refetchNotifications,
    submitSnap,
    addGroup,
    addReaction,
    addActivityItem,
    markNotificationsRead,
    respondToPrompt,
    getPromptResponses,
    updateProfile,
    joinGroup: joinGroupWithActivity,
    refreshGroups,
    logout,
  };
});
