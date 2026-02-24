import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { Group, SnapSubmission, ActivityItem, NotificationItem, PromptResponse, DailySpotlight, UserProfile, LeaderboardEntry } from '@/types';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { apiGroupListToGroup, apiGroupDetailToGroup, apiMemberToGroupMember, apiSpotlightToUI, apiResponseToSnap, apiMembersToLeaderboard, apiUserToProfile } from '@/utils/adapters';
import { ApiGroupListItem, ApiGroupDetail, ApiChallenge, ApiChallengeResponse } from '@/types/api';
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
  const querySettled = groupsQuery.isFetched || groupsQuery.isError;
  const shouldShowDemoGroup = querySettled && realGroups.length === 0 && !tourComplete;

  const groups = useMemo(() => {
    if (shouldShowDemoGroup) {
      // Recalculate challengeEndTime so it's always 30min from now
      return [{ ...DEMO_GROUP, challengeEndTime: Date.now() + 30 * 60 * 1000 }];
    }
    return realGroups;
  }, [realGroups, shouldShowDemoGroup]);

  // ── User profile mapped to UI shape ──
  const user: UserProfile = useMemo(() => {
    if (authUser) {
      return {
        ...apiUserToProfile(authUser),
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
  }, [authUser, groups.length]);

  // ── Spotlight (empty for now — endpoint may not exist) ──
  const [spotlight] = useState<DailySpotlight | null>(null);

  // ── Activity / Notifications (no backend endpoints yet) ──
  const [activity] = useState<ActivityItem[]>([]);
  const [notifications] = useState<NotificationItem[]>([]);
  const [promptResponses, setPromptResponses] = useState<PromptResponse[]>([]);
  const [snaps, setSnaps] = useState<SnapSubmission[]>([]);
  const [leaderboards, setLeaderboards] = useState<Record<string, LeaderboardEntry[]>>({});

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
        body.photo_base64 = imageUri;
      }
      body.response_time_ms = 5000;

      return api(`/challenges/${challengeId}/respond`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
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
        }),
      });
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  const addGroup = useCallback(async (group: Group) => {
    await groupMutation.mutateAsync(group);
    completeTourAction();
  }, [groupMutation, completeTourAction]);

  // ── Join group ──
  const joinGroup = useCallback(async (code: string): Promise<{ success: boolean; groupId?: string; groupName?: string; message: string }> => {
    try {
      const result = await api('/groups/join', {
        method: 'POST',
        body: JSON.stringify({ invite_code: code }),
      });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      completeTourAction();
      return { success: true, groupId: result.id, groupName: result.name, message: 'Joined successfully' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to join group';
      return { success: false, message };
    }
  }, [queryClient, completeTourAction]);

  // ── Get group snaps ──
  const getGroupSnaps = useCallback((groupId: string) => {
    return snaps.filter(s => s.groupId === groupId);
  }, [snaps]);

  // ── Reactions (local only for now) ──
  const addReaction = useCallback((snapId: string, emoji: string) => {
    setSnaps(prev => prev.map(snap => {
      if (snap.id !== snapId) return snap;
      const existing = snap.reactions.find(r => r.emoji === emoji);
      if (existing) {
        if (existing.userIds.includes(user.id)) {
          return {
            ...snap,
            reactions: snap.reactions.map(r =>
              r.emoji === emoji
                ? { ...r, count: r.count - 1, userIds: r.userIds.filter(id => id !== user.id) }
                : r
            ).filter(r => r.count > 0),
          };
        }
        return {
          ...snap,
          reactions: snap.reactions.map(r =>
            r.emoji === emoji
              ? { ...r, count: r.count + 1, userIds: [...r.userIds, user.id] }
              : r
          ),
        };
      }
      return {
        ...snap,
        reactions: [...snap.reactions, { emoji, count: 1, userIds: [user.id] }],
      };
    }));
  }, [user.id]);

  // ── Notifications ──
  const markNotificationsRead = useCallback(() => {
    // No-op — no backend endpoint yet
  }, []);

  const unreadNotificationCount = useMemo(() => {
    return notifications.filter(n => !n.read).length;
  }, [notifications]);

  // ── Onboarding (not used — auth is phone OTP now) ──
  const completeOnboarding = useCallback(async (_name: string, _username: string) => {
    // No-op — handled by auth flow
  }, []);

  // ── Prompts ──
  const respondToPrompt = useCallback((promptId: string, answer: string, selectedOption?: number) => {
    const newResponse: PromptResponse = {
      id: `resp_${Date.now()}`,
      promptId,
      userId: user.id,
      userName: user.name.split(' ')[0] || 'You',
      userAvatar: user.avatar,
      answer,
      selectedOption,
      timestamp: new Date().toISOString(),
    };
    setPromptResponses(prev => [newResponse, ...prev]);
  }, [user]);

  const getPromptResponses = useCallback((promptId: string) => {
    return promptResponses.filter(r => r.promptId === promptId);
  }, [promptResponses]);

  // ── Leaderboard ──
  const getLeaderboard = useCallback((groupId: string): LeaderboardEntry[] => {
    return leaderboards[groupId] ?? [];
  }, [leaderboards]);

  // ── Profile update ──
  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    const authStore = useAuthStore.getState();
    if (updates.name && authStore.user) {
      authStore.updateName(updates.name);
    }
    // Persist to server
    try {
      await api('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          display_name: updates.name,
          avatar_url: updates.avatar,
        }),
      });
    } catch {
      // Server update failed — local change still applied
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
    snaps,
    activity,
    spotlight,
    user,
    hasSubmittedToday,
    notifications,
    unreadNotificationCount,
    isOnboarded,
    isDataLoaded: !groupsQuery.isLoading,
    isLoading: groupsQuery.isLoading && isAuthenticated,
    isRefreshing: groupsQuery.isRefetching,
    submitSnap,
    addGroup,
    getGroupSnaps,
    addReaction,
    markNotificationsRead,
    completeOnboarding,
    respondToPrompt,
    getPromptResponses,
    getLeaderboard,
    updateProfile,
    joinGroup,
    refreshGroups,
    logout,
  };
});
