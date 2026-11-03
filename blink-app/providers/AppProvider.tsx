import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { useAuthStore } from '@/stores/authStore';
import { useGroups } from '@/hooks/useGroups';
import { useNotifications } from '@/hooks/useNotifications';
import { useProfile } from '@/hooks/useProfile';
import { useSubmitSnap } from '@/hooks/useSubmitSnap';
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
    notifications,
    unreadNotificationCount,
    markNotificationsRead,
    isNotificationsLoading,
    isNotificationsError,
    refetchNotifications,
  } = useNotifications();

  const { userProfile: user, updateProfile } = useProfile(groups.length);

  const { submitSnap } = useSubmitSnap();

  const { addReaction } = useReactions();

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
    user,
    notifications,
    unreadNotificationCount,
    isOnboarded,
    isDataLoaded,
    isLoading: isLoadingGroups,
    isRefreshing,
    isNotificationsLoading,
    isNotificationsError,
    refetchNotifications,
    submitSnap,
    addGroup: createGroup,
    addReaction,
    markNotificationsRead,
    updateProfile,
    joinGroup,
    refreshGroups,
    logout,
  };
});
