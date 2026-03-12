import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { Group, ActivityItem, NotificationItem, PromptResponse, UserProfile } from '@/types';
import { api, uploadPhoto, getActivity, getNotifications, markNotificationsRead as markNotificationsReadApi, addReactionApi, removeReactionApi, getUserStats } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { apiGroupListToGroup, apiUserToProfile } from '@/utils/adapters';
import { ApiGroupListItem, ApiChallenge } from '@/types/api';
import { DEMO_GROUP, isDemoGroup } from '@/constants/demoData';

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop';

export const [AppProvider, useApp] = createContextHook(() => {
  const queryClient = useQueryClient();
  const authUser = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authLogout = useAuthStore((s) => s.logout);
  const tourComplete = useOnboardingStore((s) => s.tourComplete);
  const completeTourAction = useOnboardingStore((s) => s.completeTour);

  // ── Groups list ──
  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: async (): Promise<Group[]> => {
      const data: ApiGroupListItem[] = await api('/groups');
      return data.map(apiGroupListToGroup);
    },
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const realGroups = groupsQuery.data ?? [];
  // Only show demo group once the query has loaded (not while still fetching)
  // Demo group disappears when: user has real groups OR tour is complete
  const querySettled = groupsQuery.isFetched || groupsQuery.isError;
  const shouldShowDemoGroup = querySettled && realGroups.length === 0 && !tourComplete;

  const groups = useMemo(() => {
    if (shouldShowDemoGroup) {
      // Recalculate challengeEndTime so it's always 30min from now
      return [{ ...DEMO_GROUP, challengeEndTime: Date.now() + 30 * 60 * 1000 }];
    }
    return realGroups;
  }, [realGroups, shouldShowDemoGroup]);

  // ── User stats (aggregate across all groups) ──
  const statsQuery = useQuery({
    queryKey: ['userStats'],
    queryFn: getUserStats,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  // ── User profile mapped to UI shape ──
  const user: UserProfile = useMemo(() => {
    const stats = statsQuery.data;
    if (authUser) {
      return {
        ...apiUserToProfile(authUser),
        totalSnaps: stats?.total_snaps ?? 0,
        longestStreak: stats?.longest_streak ?? 0,
        groupCount: groups.length,
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
  }, [authUser, groups.length, statsQuery.data]);

  // ── Activity (backend wired via React Query) ──
  const activityQuery = useQuery({
    queryKey: ['activity'],
    queryFn: getActivity,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const [localActivity, setLocalActivity] = useState<ActivityItem[]>([]);

  // Merge backend activity with local optimistic items
  const activity = useMemo(() => {
    const backendItems = activityQuery.data ?? [];
    // Prepend local-only items (they have ids starting with 'activity_')
    const backendIds = new Set(backendItems.map(i => i.id));
    const uniqueLocal = localActivity.filter(i => !backendIds.has(i.id));
    return [...uniqueLocal, ...backendItems];
  }, [activityQuery.data, localActivity]);

  // ── Notifications (backend wired via React Query) ──
  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const notifications = notificationsQuery.data ?? [];

  // ── Add activity item helper ──
  const addActivityItem = useCallback((
    type: ActivityItem['type'],
    groupName: string,
    groupId: string,
    message: string,
    imageUrl?: string,
  ) => {
    const item: ActivityItem = {
      id: `activity_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      userId: user.id || 'self',
      userName: user.name?.split(' ')[0] || 'You',
      userAvatar: user.avatar,
      groupName,
      groupId,
      message,
      timestamp: new Date().toISOString(),
      imageUrl,
    };
    setLocalActivity(prev => [item, ...prev]);
    // Also invalidate to re-fetch from server
    queryClient.invalidateQueries({ queryKey: ['activity'] });
  }, [user.id, user.name, user.avatar]);
  const [promptResponses, setPromptResponses] = useState<PromptResponse[]>([]);

  // ── Submission tracking ──
  const [hasSubmittedToday] = useState(false);

  // ── isOnboarded = isAuthenticated ──
  const isOnboarded = isAuthenticated;

  // ── Submit snap ──
  const snapMutation = useMutation({
    mutationFn: async ({ groupId, imageUri }: { groupId: string; imageUri?: string }) => {
      // Skip API calls for demo group
      if (isDemoGroup(groupId)) return;

      // Find active challenge for this group
      let challengeId: string | null = null;
      try {
        const challenge: ApiChallenge = await api(`/challenges/groups/${groupId}/challenges/active`);
        challengeId = challenge.id;
      } catch {
        // No active challenge
      }

      if (!challengeId) {
        // Stale local state — refresh groups and bail gracefully
        queryClient.invalidateQueries({ queryKey: ['groups'] });
        return;
      }

      const body: Record<string, unknown> = {};
      if (imageUri) {
        const photoUrl = await uploadPhoto(imageUri, groupId, challengeId);
        body.photo_url = photoUrl;
      }
      body.response_time_ms = 5000;

      return api(`/challenges/${challengeId}/respond`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: (_data, { groupId }) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['responses'] });
      queryClient.invalidateQueries({ queryKey: ['userStats'] });
      // Track activity
      const group = groups.find(g => g.id === groupId);
      addActivityItem('snap', group?.name ?? 'Group', groupId, 'submitted a snap');
    },
    onError: (error: Error) => {
      Alert.alert('Snap Failed', error.message || 'Could not submit your snap. Please try again.');
    },
  });

  const submitSnap = useCallback(async (groupId: string, imageUri?: string) => {
    await snapMutation.mutateAsync({ groupId, imageUri });
  }, [snapMutation]);

  // ── Add group ──
  const groupMutation = useMutation({
    mutationFn: async (group: Group) => {
      const result = await api('/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: group.name,
          icon: group.emoji,
          category: group.category === 'close_friends' ? 'friends' : group.category,
          skip_penalty_type: 'none',
          ai_personality: group.aiPersonality ?? 'funny',
        }),
      });
      return result;
    },
    onSuccess: (_data, group) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      // Track activity
      addActivityItem('join', group.name, group.id, 'created a new group');
    },
    onError: (error: Error) => {
      Alert.alert('Create Group Failed', error.message || 'Could not create the group. Please try again.');
    },
  });

  const addGroup = useCallback(async (group: Group) => {
    await groupMutation.mutateAsync(group);
    completeTourAction();
  }, [groupMutation, completeTourAction]);

  // ── Join group ──
  const joinGroup = useCallback(async (code: string): Promise<{ success: boolean; groupId?: string; groupName?: string; message: string }> => {
    try {
      const result = await api<{ id: string; name: string }>('/groups/join', {
        method: 'POST',
        body: JSON.stringify({ invite_code: code }),
      });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      completeTourAction();
      // Track activity
      addActivityItem('join', result.name ?? 'Group', result.id, 'joined the group');
      return { success: true, groupId: result.id, groupName: result.name, message: 'Joined successfully' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to join group';
      Alert.alert('Join Failed', message);
      return { success: false, message };
    }
  }, [queryClient, completeTourAction, addActivityItem]);

  // ── Reactions (wired to server API) ──
  const addReaction = useCallback(async (responseId: string, emoji: string) => {
    try {
      await addReactionApi(responseId, emoji);
    } catch {
      // If 409 conflict (already reacted), try removing instead (toggle behavior)
      try {
        await removeReactionApi(responseId, emoji);
      } catch {
        // Silently fail
      }
    }
    // Refresh the challenge responses to reflect updated reactions
    queryClient.invalidateQueries({ queryKey: ['responses'] });
  }, [queryClient]);

  // ── Notifications ──
  const markNotificationsRead = useCallback(async () => {
    try {
      await markNotificationsReadApi();
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch {
      // Silently fail — UI already marked as read locally
    }
  }, [queryClient]);

  const unreadNotificationCount = useMemo(() => {
    return notifications.filter(n => !n.read).length;
  }, [notifications]);

  // ── Onboarding (not used — auth is phone OTP now) ──
  const completeOnboarding = useCallback(async (_name: string, _username: string) => {
    // No-op — handled by auth flow
  }, []);

  // ── Prompts ──
  const respondToPrompt = useCallback(async (promptId: string, answer: string, selectedOption?: number) => {
    // Optimistic local update
    const newResponse: PromptResponse = {
      id: `resp_${Date.now()}`,
      promptId,
      userId: user.id,
      userName: user.name?.split(' ')[0] || 'You',
      userAvatar: user.avatar,
      answer,
      selectedOption,
      timestamp: new Date().toISOString(),
    };
    setPromptResponses(prev => [newResponse, ...prev]);

    // Persist to backend
    try {
      await api(`/challenges/${promptId}/respond`, {
        method: 'POST',
        body: JSON.stringify({
          answer_text: answer,
          ...(selectedOption !== undefined ? { answer_index: selectedOption } : {}),
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['responses', promptId] });
    } catch (e) {
      if (__DEV__) console.warn('[respondToPrompt] API error:', e);
    }
  }, [user, queryClient]);

  const getPromptResponses = useCallback((promptId: string) => {
    return promptResponses.filter(r => r.promptId === promptId);
  }, [promptResponses]);

  // ── Profile update ──
  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    const authStore = useAuthStore.getState();
    if (updates.name && authStore.user) {
      authStore.updateName(updates.name);
    }
    // Persist to server (only server-supported fields)
    try {
      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.display_name = updates.name;
      // Only send avatar_url if it's a real URL (not a local file URI)
      if (updates.avatar !== undefined && updates.avatar.startsWith('http')) {
        payload.avatar_url = updates.avatar;
      }
      // Only call API if there are server-side fields to update
      if (Object.keys(payload).length > 0) {
        await api('/auth/profile', {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not save profile changes.';
      Alert.alert('Profile Update Failed', message);
      throw err; // Re-throw so callers (e.g. edit-profile screen) can handle it
    }
  }, []);

  // ── Logout ──
  const logout = useCallback(async () => {
    await authLogout();
    queryClient.clear();
  }, [authLogout, queryClient]);

  const refreshGroups = useCallback(() => {
    return groupsQuery.refetch();
  }, [groupsQuery]);

  return {
    groups,
    shouldShowDemoGroup,
    activity,
    user,
    hasSubmittedToday,
    notifications,
    unreadNotificationCount,
    isOnboarded,
    isDataLoaded: !groupsQuery.isLoading,
    isLoading: groupsQuery.isLoading && isAuthenticated,
    isRefreshing: groupsQuery.isRefetching,
    isActivityLoading: activityQuery.isLoading,
    isActivityError: activityQuery.isError,
    refetchActivity: activityQuery.refetch,
    isNotificationsLoading: notificationsQuery.isLoading,
    isNotificationsError: notificationsQuery.isError,
    refetchNotifications: notificationsQuery.refetch,
    submitSnap,
    addGroup,
    addReaction,
    addActivityItem,
    markNotificationsRead,
    completeOnboarding,
    respondToPrompt,
    getPromptResponses,
    updateProfile,
    joinGroup,
    refreshGroups,
    logout,
  };
});
