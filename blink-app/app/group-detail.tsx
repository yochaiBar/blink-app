import React, { useCallback, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, RefreshControl, Modal, Alert, Share } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { ArrowLeft, Camera, ChevronRight, Flame, MoreHorizontal, Share2, Trophy, UserPlus, Zap, X, LogOut, Trash2, Clock, Flag } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import SnapCard from '@/components/SnapCard';
import SpotlightCard from '@/components/SpotlightCard';
import ReportModal from '@/components/ReportModal';
import { categoryLabels } from '@/constants/categories';
import { api, blockUser, getSpotlight } from '@/services/api';
import { Users } from 'lucide-react-native';
import { Skeleton, SnapCardSkeleton, EmptyState, ErrorState } from '@/components/ui';
import { ApiGroupDetail, ApiChallenge, ApiChallengeResponse, ApiSpotlight } from '@/types/api';
import { apiGroupDetailToGroup, apiResponseToSnap, apiSpotlightToUI, apiMembersToLeaderboard } from '@/utils/adapters';
import { isDemoGroup, DEMO_GROUP_DETAIL, DEMO_CHALLENGE, DEMO_RESPONSES } from '@/constants/demoData';
import { useOnboardingStore } from '@/stores/onboardingStore';
import Tooltip, { TargetLayout } from '@/components/Tooltip';

type ChallengeType = 'snap' | 'quiz' | 'quiz_food' | 'quiz_most_likely' | 'quiz_rate_day';

const challengeTypes: { type: ChallengeType; emoji: string; label: string }[] = [
  { type: 'snap', emoji: '📸', label: 'Snap Challenge' },
  { type: 'quiz_food', emoji: '🍔', label: 'Food Quiz' },
  { type: 'quiz_most_likely', emoji: '👀', label: 'Most Likely To' },
  { type: 'quiz_rate_day', emoji: '⭐', label: 'Rate Your Day' },
];

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { addReaction, user } = useApp();
  const isDemo = isDemoGroup(id);

  const tourStep = useOnboardingStore((s) => s.tourStep);
  const advanceTour = useOnboardingStore((s) => s.advanceTour);
  const completeTour = useOnboardingStore((s) => s.completeTour);

  const [countdown, setCountdown] = useState<string>('');
  const [showRingModal, setShowRingModal] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    contentType: 'photo' | 'user' | 'group' | 'challenge_response';
    reportedUserId?: string;
    reportedContentId?: string;
  }>({ contentType: 'photo' });
  const [challengeBarLayout, setChallengeBarLayout] = useState<TargetLayout | null>(null);
  const challengeBarRef = useRef<View>(null);

  // Fetch full group detail with members
  const groupQuery = useQuery({
    queryKey: ['group', id],
    queryFn: async () => {
      if (isDemo) return DEMO_GROUP_DETAIL;
      const detail: ApiGroupDetail = await api(`/groups/${id}`);
      return detail;
    },
    enabled: !!id,
    staleTime: isDemo ? Infinity : 15_000,
  });

  // Fetch active challenge
  const challengeQuery = useQuery({
    queryKey: ['challenge', id],
    queryFn: async () => {
      if (isDemo) return { ...DEMO_CHALLENGE, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
      const challenge: ApiChallenge = await api(`/challenges/groups/${id}/challenges/active`);
      return challenge;
    },
    enabled: !!id,
    retry: isDemo ? false : false,
    staleTime: isDemo ? Infinity : undefined,
  });

  const activeChallenge = challengeQuery.data ?? null;

  // Fetch challenge responses
  const responsesQuery = useQuery({
    queryKey: ['responses', isDemo ? 'demo' : activeChallenge?.id],
    queryFn: async () => {
      if (isDemo) return DEMO_RESPONSES;
      if (!activeChallenge?.id) return [];
      const responses: ApiChallengeResponse[] = await api(`/challenges/${activeChallenge.id}/responses`);
      return responses;
    },
    enabled: isDemo ? !!id : !!activeChallenge?.id,
    staleTime: isDemo ? Infinity : undefined,
  });

  // Fetch daily spotlight for this group
  const spotlightQuery = useQuery({
    queryKey: ['spotlight', id],
    queryFn: async () => {
      const data: ApiSpotlight | null = await getSpotlight(id!);
      return data;
    },
    enabled: !!id && !isDemo,
    staleTime: 60_000,
    retry: false,
  });

  const spotlight = spotlightQuery.data
    ? apiSpotlightToUI(spotlightQuery.data, id)
    : null;

  // Build UI group from API detail
  const group = groupQuery.data
    ? apiGroupDetailToGroup(groupQuery.data, activeChallenge)
    : null;

  // Compute leaderboard from group members
  const leaderboard = groupQuery.data?.members
    ? apiMembersToLeaderboard(groupQuery.data.members)
    : [];
  const leaderboardTop3 = leaderboard.slice(0, 3);

  const snaps = (responsesQuery.data ?? []).map((r) => ({
    ...apiResponseToSnap(r),
    groupId: id ?? '',
  }));

  const hasSubmittedToday = isDemo ? false : (
    snaps.some((s) => s.userId === user.id) ||
    (responsesQuery.data ?? []).some((r) => r.user_id === user.id)
  );

  const isQuizChallenge = activeChallenge?.type && activeChallenge.type !== 'snap';

  // Compute quiz result distribution
  const quizOptions: string[] = React.useMemo(() => {
    if (!isQuizChallenge || !activeChallenge) return [];
    const opts = activeChallenge.options_json ?? activeChallenge.options ?? [];
    if (typeof opts === 'string') {
      try { return JSON.parse(opts); } catch { return []; }
    }
    return Array.isArray(opts) ? opts : [];
  }, [activeChallenge, isQuizChallenge]);

  const quizDistribution = React.useMemo(() => {
    if (!isQuizChallenge || !responsesQuery.data || quizOptions.length === 0) return [];
    const counts = quizOptions.map(() => 0);
    const respondents: Record<number, { name: string; avatar: string }[]> = {};
    for (const r of responsesQuery.data) {
      const idx = r.answer_index;
      if (idx !== null && idx !== undefined && idx < counts.length) {
        counts[idx]++;
        if (!respondents[idx]) respondents[idx] = [];
        respondents[idx].push({
          name: r.display_name ?? 'User',
          avatar: r.avatar_url ?? 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop',
        });
      }
    }
    const total = counts.reduce((a, b) => a + b, 0);
    return quizOptions.map((opt: string, i: number) => ({
      label: opt,
      count: counts[i],
      percentage: total > 0 ? Math.round((counts[i] / total) * 100) : 0,
      respondents: respondents[i] ?? [],
    }));
  }, [responsesQuery.data, quizOptions, isQuizChallenge]);

  // Ring mutation: create a new challenge
  const ringMutation = useMutation({
    mutationFn: async (type: ChallengeType) => {
      return api(`/challenges/groups/${id}/challenges`, {
        method: 'POST',
        body: JSON.stringify({ type }),
      });
    },
    onSuccess: (data, type) => {
      queryClient.invalidateQueries({ queryKey: ['challenge', id] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setShowRingModal(false);
      if (type === 'snap') {
        router.push({ pathname: '/snap-challenge' as never, params: { groupId: id } });
      } else if (type === 'quiz_food' || type === 'quiz_most_likely' || type === 'quiz_rate_day') {
        router.push({
          pathname: '/quiz-challenge' as never,
          params: {
            groupId: id,
            challengeId: data?.id ?? '',
            type,
            promptText: data?.prompt_text ?? data?.prompt ?? '',
            optionsJson: JSON.stringify(data?.options_json ?? data?.options ?? []),
            expiresAt: data?.expires_at ?? '',
          },
        });
      } else {
        router.push({ pathname: '/group-prompt' as never, params: { groupId: id } });
      }
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message || 'Failed to create challenge');
    },
  });

  // Derive admin status
  const isAdmin = group
    ? group.members.some((m) => m.id === user.id && m.role === 'admin') || group.createdBy === user.id
    : false;

  // Debug: trace admin check in dev mode
  if (__DEV__ && group) {
    console.log('[GroupDetail] isAdmin:', isAdmin, '| user.id:', user.id, '| createdBy:', group.createdBy, '| members:', group.members.map(m => ({ id: m.id, role: m.role })));
  }

  const handleGroupMenu = useCallback(() => {
    setShowGroupMenu(true);
  }, []);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api(`/groups/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.removeQueries({ queryKey: ['group', id] });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      router.back();
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message || 'Failed to delete group');
    },
  });

  const handleDeleteGroup = useCallback(() => {
    setShowGroupMenu(false);
    // Use setTimeout to let the modal close before showing the confirm dialog
    setTimeout(() => {
      if (Platform.OS === 'web') {
        // On web, window.confirm is more reliable than Alert.alert with button callbacks
        const confirmed = window.confirm('Delete Group?\n\nAre you sure? This action cannot be undone and all members will lose access.');
        if (confirmed) {
          deleteMutation.mutate();
        }
      } else {
        Alert.alert('Delete Group', 'Are you sure? This action cannot be undone and all members will lose access.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => deleteMutation.mutate(),
          },
        ]);
      }
    }, 300);
  }, [deleteMutation]);

  const handleLeaveGroup = useCallback(() => {
    setShowGroupMenu(false);
    const doLeave = async () => {
      try {
        await api(`/groups/${id}/leave`, { method: 'POST' });
        queryClient.invalidateQueries({ queryKey: ['groups'] });
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        router.back();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to leave group';
        Alert.alert('Error', message);
      }
    };
    setTimeout(() => {
      if (Platform.OS === 'web') {
        const confirmed = window.confirm('Leave Group?\n\nAre you sure? You will need an invite to rejoin.');
        if (confirmed) doLeave();
      } else {
        Alert.alert('Leave Group', 'Are you sure? You will need an invite to rejoin.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: doLeave },
        ]);
      }
    }, 300);
  }, [id, queryClient, router]);

  const handleShareGroup = useCallback(() => {
    setShowGroupMenu(false);
    Share.share({
      message: `Join my group "${group?.name}" on Blink! Use invite code: ${group?.inviteCode}`,
    });
  }, [group?.name, group?.inviteCode]);

  useEffect(() => {
    if (!group?.challengeEndTime) return;
    const update = () => {
      const remaining = Math.max(0, (group.challengeEndTime ?? 0) - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${mins}:${secs.toString().padStart(2, '0')}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [group?.challengeEndTime]);

  // Measure challenge bar for tooltip
  useEffect(() => {
    if (isDemo && tourStep === 'group_detail' && challengeBarRef.current) {
      const timer = setTimeout(() => {
        challengeBarRef.current?.measureInWindow((x, y, width, height) => {
          if (width > 0) setChallengeBarLayout({ x, y, width, height });
        });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isDemo, tourStep, group]);

  const handleSnapChallenge = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }

    // Demo group: advance tour and go back to home
    if (isDemo) {
      advanceTour('fab');
      router.back();
      return;
    }

    if (activeChallenge?.type === 'snap') {
      router.push({ pathname: '/snap-challenge' as never, params: { groupId: id } });
    } else if (
      activeChallenge?.type === 'quiz' ||
      activeChallenge?.type === 'quiz_food' ||
      activeChallenge?.type === 'quiz_most_likely' ||
      activeChallenge?.type === 'quiz_rate_day'
    ) {
      router.push({
        pathname: '/quiz-challenge' as never,
        params: {
          groupId: id,
          challengeId: activeChallenge.id,
          type: activeChallenge.type,
          promptText: activeChallenge.prompt_text ?? activeChallenge.prompt ?? '',
          optionsJson: JSON.stringify(activeChallenge.options_json ?? activeChallenge.options ?? []),
          expiresAt: activeChallenge.expires_at,
        },
      });
    } else {
      // Fallback for unknown types
      router.push({ pathname: '/group-prompt' as never, params: { groupId: id } });
    }
  }, [router, id, activeChallenge, isDemo, advanceTour]);

  const handleReaction = useCallback((snapId: string, emoji: string) => {
    addReaction(snapId, emoji);
  }, [addReaction]);

  const handleReportSnap = useCallback((snapId: string, userId: string) => {
    setReportTarget({ contentType: 'challenge_response', reportedContentId: snapId, reportedUserId: userId });
    setShowReportModal(true);
  }, []);

  const handleBlockUser = useCallback((userId: string, userName: string) => {
    const doBlock = async () => {
      try {
        await blockUser(userId);
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Blocked', `${userName} has been blocked. You won't see their content anymore.`);
        // Refresh responses to filter out blocked user
        responsesQuery.refetch();
      } catch {
        Alert.alert('Error', 'Could not block user. Please try again.');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Block ${userName}?\n\nYou won't see their content and they won't see yours.`)) doBlock();
    } else {
      Alert.alert(
        `Block ${userName}?`,
        "You won't see their content and they won't see yours.",
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Block', style: 'destructive', onPress: doBlock },
        ]
      );
    }
  }, [responsesQuery]);

  const handleRing = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    setShowRingModal(true);
  }, []);

  const onRefresh = useCallback(() => {
    if (isDemo) return;
    groupQuery.refetch();
    challengeQuery.refetch();
    spotlightQuery.refetch();
    if (activeChallenge?.id) responsesQuery.refetch();
  }, [groupQuery, challengeQuery, responsesQuery, spotlightQuery, activeChallenge, isDemo]);

  // Tour tooltip handler for step 2
  const handleGroupDetailTourNext = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    advanceTour('fab');
    router.back();
  }, [advanceTour, router]);

  if (groupQuery.isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
        <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Skeleton variant="circle" width={36} height={36} borderRadius={10} />
            <View style={{ gap: 6 }}>
              <Skeleton variant="text" width={140} height={16} />
              <Skeleton variant="text" width={80} height={12} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} variant="circle" width={28} height={28} />
            ))}
            <Skeleton variant="text" width={70} height={14} />
          </View>
          <SnapCardSkeleton />
          <SnapCardSkeleton />
        </View>
      </View>
    );
  }

  if (groupQuery.isError) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
        <ErrorState
          message="Failed to load group details"
          onRetry={() => groupQuery.refetch()}
        />
      </View>
    );
  }

  if (!group) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
        <EmptyState
          emoji="😅"
          title="Group not found"
          subtitle="It may have been deleted or you lost access."
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerEmoji}>{group.emoji}</Text>
          <Text style={styles.headerTitle}>{group.name}</Text>
        </View>
        <View style={styles.headerActions}>
          {!isDemo && (
            <>
              <TouchableOpacity
                style={styles.headerActionBtn}
                onPress={() => router.push({ pathname: '/invite-members' as never, params: { groupId: id } })}
              >
                <UserPlus size={18} color={theme.text} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerActionBtn} onPress={handleGroupMenu}>
                <MoreHorizontal size={18} color={theme.text} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <View style={styles.groupMeta}>
        <View style={[styles.categoryBadge, { backgroundColor: `${group.color}20` }]}>
          <Text style={[styles.categoryText, { color: group.color }]}>
            {categoryLabels[group.category]}
          </Text>
        </View>
        <View style={styles.membersPreview}>
          {group.members.slice(0, 6).map((member, i) => (
            <Image
              key={member.id}
              source={{ uri: member.avatar }}
              style={[styles.memberAvatar, { marginLeft: i > 0 ? -8 : 0, zIndex: 6 - i }]}
              contentFit="cover"
            />
          ))}
          <Text style={styles.memberCount}>{group.members.length} members</Text>
        </View>
      </View>

      {!isDemo && (
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: theme.yellowMuted }]}
            onPress={() => router.push({ pathname: '/group-leaderboard' as never, params: { groupId: id } })}
          >
            <Trophy size={16} color={theme.yellow} />
            <Text style={[styles.quickActionText, { color: theme.yellow }]}>Leaderboard</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: theme.greenMuted }]}
            onPress={() => router.push({ pathname: '/invite-members' as never, params: { groupId: id } })}
          >
            <Share2 size={16} color={theme.green} />
            <Text style={[styles.quickActionText, { color: theme.green }]}>Invite</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: theme.purpleMuted }]}
            onPress={() => router.push({ pathname: '/challenge-history' as never, params: { groupId: id } })}
          >
            <Clock size={16} color={theme.purple} />
            <Text style={[styles.quickActionText, { color: theme.purple }]}>History</Text>
          </TouchableOpacity>

          {!activeChallenge && (
            <TouchableOpacity
              style={[styles.quickAction, { backgroundColor: theme.coralMuted }]}
              onPress={handleRing}
            >
              <Zap size={16} color={theme.coral} />
              <Text style={[styles.quickActionText, { color: theme.coral }]}>Ring!</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {group.hasActiveChallenge && !hasSubmittedToday && (
        <View ref={challengeBarRef} collapsable={false}>
          <TouchableOpacity
            style={[styles.challengeBar, isQuizChallenge && { backgroundColor: theme.purple }]}
            onPress={handleSnapChallenge}
            activeOpacity={0.85}
            testID="snap-challenge-btn"
          >
            <View style={styles.challengeContent}>
              {isQuizChallenge ? (
                <Zap size={20} color={theme.white} />
              ) : (
                <Camera size={20} color={theme.white} />
              )}
              <View>
                <Text style={styles.challengeTitle}>
                  {activeChallenge?.type === 'snap' ? 'Snap Challenge Active!' :
                   activeChallenge?.type === 'quiz' ? 'Quiz Active!' : 'Challenge Active!'}
                </Text>
                <Text style={styles.challengeSubtitle}>Tap to respond</Text>
              </View>
            </View>
            <View style={styles.challengeTimer}>
              <Text style={styles.challengeTimerText}>{countdown}</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {hasSubmittedToday && activeChallenge && (
        <View style={styles.submittedBanner}>
          <View style={styles.submittedRow}>
            <Text style={styles.submittedText}>You submitted! Check out your crew's snaps</Text>
            {countdown ? (
              <View style={styles.countdownBadge}>
                <Clock size={12} color={theme.green} />
                <Text style={styles.countdownText}>{countdown}</Text>
              </View>
            ) : null}
          </View>
        </View>
      )}

      <ScrollView
        style={styles.feed}
        contentContainerStyle={styles.feedContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={!isDemo && groupQuery.isRefetching}
            onRefresh={onRefresh}
            tintColor={theme.coral}
          />
        }
      >
        {/* Daily Spotlight */}
        {spotlight && !isDemo && (
          <SpotlightCard spotlight={spotlight} />
        )}

        {/* Leaderboard Preview (top 3) */}
        {leaderboardTop3.length > 0 && !isDemo && (
          <View style={styles.leaderboardPreview}>
            <TouchableOpacity
              style={styles.leaderboardPreviewHeader}
              onPress={() => router.push({ pathname: '/group-leaderboard' as never, params: { groupId: id } })}
              activeOpacity={0.7}
            >
              <View style={styles.leaderboardPreviewTitleRow}>
                <Trophy size={16} color={theme.yellow} />
                <Text style={styles.leaderboardPreviewTitle}>Leaderboard</Text>
              </View>
              <View style={styles.leaderboardSeeAll}>
                <Text style={styles.leaderboardSeeAllText}>See all</Text>
                <ChevronRight size={14} color={theme.textMuted} />
              </View>
            </TouchableOpacity>
            {leaderboardTop3.map((entry, i) => {
              const isMe = entry.userId === user.id;
              const rankEmojis = ['🥇', '🥈', '🥉'];
              return (
                <View key={entry.userId} style={[styles.leaderboardRow, isMe && styles.leaderboardRowMe]}>
                  <Text style={styles.leaderboardRank}>{rankEmojis[i]}</Text>
                  <Image source={{ uri: entry.userAvatar }} style={styles.leaderboardAvatar} contentFit="cover" />
                  <View style={styles.leaderboardInfo}>
                    <Text style={[styles.leaderboardName, isMe && { color: theme.coral }]} numberOfLines={1}>
                      {entry.userName}{isMe ? ' (you)' : ''}
                    </Text>
                    <View style={styles.leaderboardStreakRow}>
                      <Flame size={11} color={theme.yellow} />
                      <Text style={styles.leaderboardStreakText}>{entry.streak} day streak</Text>
                    </View>
                  </View>
                  <Text style={styles.leaderboardScore}>{entry.score}</Text>
                </View>
              );
            })}
          </View>
        )}

        {!hasSubmittedToday && snaps.length > 0 && !isDemo && (
          <View style={styles.peekNotice}>
            <Text style={styles.peekNoticeText}>Submit your snap to see what everyone shared!</Text>
          </View>
        )}

        {responsesQuery.isLoading && activeChallenge ? (
          <>
            <SnapCardSkeleton />
            <SnapCardSkeleton />
          </>
        ) : responsesQuery.isError ? (
          <ErrorState
            message="Failed to load snaps"
            onRetry={() => responsesQuery.refetch()}
            compact
          />
        ) : isQuizChallenge && activeChallenge ? (
          /* Quiz Results Inline */
          hasSubmittedToday && quizDistribution.length > 0 ? (
            <View style={styles.quizResultsContainer}>
              <View style={styles.quizResultsHeader}>
                <Text style={styles.quizPromptText}>
                  {activeChallenge.prompt_text ?? activeChallenge.prompt ?? 'Quiz'}
                </Text>
                <View style={styles.quizResponseCount}>
                  <Users size={14} color={theme.textMuted} />
                  <Text style={styles.quizResponseCountText}>
                    {(responsesQuery.data ?? []).length} {(responsesQuery.data ?? []).length === 1 ? 'response' : 'responses'}
                  </Text>
                </View>
              </View>
              {quizDistribution.map((item, i) => {
                const isTopAnswer = quizDistribution.every((d) => item.count >= d.count) && item.count > 0;
                const myResponse = (responsesQuery.data ?? []).find((r) => r.user_id === user.id);
                const isMyPick = myResponse?.answer_index === i;
                return (
                  <View key={i} style={styles.quizResultRow}>
                    <View style={styles.quizResultHeader}>
                      <View style={styles.quizResultLabelRow}>
                        <Text style={[styles.quizResultLabel, isTopAnswer && { color: theme.coral }]}>
                          {item.label}
                        </Text>
                        {isMyPick && (
                          <View style={styles.quizMyPickBadge}>
                            <Text style={styles.quizMyPickText}>You</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.quizResultPercent}>{item.percentage}%</Text>
                    </View>
                    <View style={styles.quizProgressBg}>
                      <View style={[
                        styles.quizProgressFill,
                        { width: `${item.percentage}%`, backgroundColor: isTopAnswer ? theme.coral : theme.surfaceLight },
                      ]} />
                    </View>
                    {item.respondents.length > 0 && (
                      <View style={styles.quizRespondentsRow}>
                        {item.respondents.slice(0, 5).map((r, ri) => (
                          <Image
                            key={ri}
                            source={{ uri: r.avatar }}
                            style={[styles.quizRespondentAvatar, { marginLeft: ri > 0 ? -6 : 0, zIndex: 5 - ri }]}
                            contentFit="cover"
                          />
                        ))}
                        {item.respondents.length > 5 && (
                          <Text style={styles.quizMoreRespondents}>+{item.respondents.length - 5}</Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : !hasSubmittedToday ? (
            <EmptyState
              emoji="🧠"
              title="Quiz active!"
              subtitle="Tap the challenge bar to answer"
            />
          ) : (
            <EmptyState
              emoji="⏳"
              title="Waiting for responses"
              subtitle="Results appear when others answer"
            />
          )
        ) : snaps.length === 0 ? (
          <EmptyState
            emoji="📸"
            title="No snaps yet"
            subtitle="Start a challenge to see snaps here!"
          />
        ) : (
          snaps.map(snap => (
            <SnapCard
              key={snap.id}
              snap={snap}
              isLocked={isDemo ? false : !hasSubmittedToday}
              onReact={handleReaction}
              onReport={handleReportSnap}
              onBlock={handleBlockUser}
            />
          ))
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Tour Tooltip: Step 2 — Challenge bar */}
      <Tooltip
        visible={isDemo && tourStep === 'group_detail'}
        message="Your friends posted snaps — take yours!"
        targetLayout={challengeBarLayout}
        position="below"
        onNext={handleGroupDetailTourNext}
        onDismiss={completeTour}
        nextLabel="Got it"
        step={2}
        totalSteps={3}
      />

      {/* Ring Modal — Challenge Type Picker */}
      <Modal visible={showRingModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Start a Challenge</Text>
              <TouchableOpacity onPress={() => setShowRingModal(false)} style={styles.modalClose}>
                <X size={20} color={theme.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.challengeGrid}>
              {challengeTypes.map((ct) => (
                <TouchableOpacity
                  key={ct.type}
                  style={styles.challengeTypeBtn}
                  onPress={() => {
                    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    ringMutation.mutate(ct.type);
                  }}
                  disabled={ringMutation.isPending}
                  activeOpacity={0.8}
                >
                  <Text style={styles.challengeTypeEmoji}>{ct.emoji}</Text>
                  <Text style={styles.challengeTypeLabel}>{ct.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Group Menu Modal */}
      <Modal visible={showGroupMenu} transparent animationType="slide">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowGroupMenu(false)}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{group.name}</Text>
              <TouchableOpacity onPress={() => setShowGroupMenu(false)} style={styles.modalClose}>
                <X size={20} color={theme.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.menuList}>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowGroupMenu(false);
                  router.push({ pathname: '/invite-members' as never, params: { groupId: id } });
                }}
              >
                <UserPlus size={20} color={theme.text} />
                <Text style={styles.menuItemText}>Invite Members</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={handleShareGroup}>
                <Share2 size={20} color={theme.text} />
                <Text style={styles.menuItemText}>Share Group</Text>
              </TouchableOpacity>

              {isAdmin && (
                <TouchableOpacity style={styles.menuItem} onPress={handleDeleteGroup}>
                  <Trash2 size={20} color={theme.red} />
                  <Text style={[styles.menuItemText, { color: theme.red }]}>Delete Group</Text>
                </TouchableOpacity>
              )}

              {!isAdmin && (
                <TouchableOpacity style={styles.menuItem} onPress={handleLeaveGroup}>
                  <LogOut size={20} color={theme.red} />
                  <Text style={[styles.menuItemText, { color: theme.red }]}>Leave Group</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowGroupMenu(false);
                  setReportTarget({ contentType: 'group', reportedContentId: id });
                  setShowReportModal(true);
                }}
              >
                <Flag size={20} color={theme.yellow} />
                <Text style={[styles.menuItemText, { color: theme.yellow }]}>Report Group</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Report Modal */}
      <ReportModal
        visible={showReportModal}
        onClose={() => setShowReportModal(false)}
        reportedUserId={reportTarget.reportedUserId}
        reportedContentId={reportTarget.reportedContentId}
        contentType={reportTarget.contentType}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  errorText: {
    fontSize: 16,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerEmoji: {
    fontSize: 22,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: theme.text,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupMeta: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 10,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  membersPreview: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: theme.bg,
  },
  memberCount: {
    fontSize: 13,
    color: theme.textSecondary,
    marginLeft: 10,
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 8,
    paddingVertical: 10,
  },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  challengeBar: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: theme.coral,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  challengeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  challengeTitle: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: theme.white,
  },
  challengeSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 1,
  },
  challengeTimer: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  challengeTimerText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: theme.white,
    fontVariant: ['tabular-nums'],
  },
  submittedBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: theme.greenMuted,
    borderRadius: 12,
    padding: 12,
  },
  submittedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  submittedText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: theme.green,
  },
  countdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  countdownText: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: theme.green,
    fontVariant: ['tabular-nums'],
  },
  feed: {
    flex: 1,
  },
  feedContent: {
    paddingHorizontal: 20,
  },
  peekNotice: {
    backgroundColor: theme.yellowMuted,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  peekNoticeText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: theme.yellow,
    textAlign: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 8,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: theme.text,
  },
  emptySubtext: {
    fontSize: 14,
    color: theme.textMuted,
  },
  // Quiz results styles
  quizResultsContainer: {
    gap: 10,
    marginBottom: 16,
  },
  quizResultsHeader: {
    backgroundColor: theme.bgCard,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    marginBottom: 4,
  },
  quizPromptText: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: theme.text,
    lineHeight: 24,
  },
  quizResponseCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quizResponseCountText: {
    fontSize: 13,
    color: theme.textMuted,
    fontWeight: '600' as const,
  },
  quizResultRow: {
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  quizResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quizResultLabelRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quizResultLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: theme.text,
  },
  quizResultPercent: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: theme.textSecondary,
    fontVariant: ['tabular-nums'] as const,
  },
  quizMyPickBadge: {
    backgroundColor: theme.blueMuted,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  quizMyPickText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: theme.blue,
  },
  quizProgressBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.surface,
    overflow: 'hidden' as const,
  },
  quizProgressFill: {
    height: '100%' as const,
    borderRadius: 3,
  },
  quizRespondentsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quizRespondentAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.bgCard,
  },
  quizMoreRespondents: {
    fontSize: 11,
    color: theme.textMuted,
    marginLeft: 6,
  },
  // Leaderboard preview styles
  leaderboardPreview: {
    backgroundColor: theme.bgCard,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    gap: 6,
  },
  leaderboardPreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  leaderboardPreviewTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  leaderboardPreviewTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: theme.text,
  },
  leaderboardSeeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  leaderboardSeeAllText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: theme.textMuted,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  leaderboardRowMe: {
    backgroundColor: `${theme.coral}10`,
  },
  leaderboardRank: {
    fontSize: 18,
    width: 28,
    textAlign: 'center',
  },
  leaderboardAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  leaderboardInfo: {
    flex: 1,
    gap: 2,
  },
  leaderboardName: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: theme.text,
  },
  leaderboardStreakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  leaderboardStreakText: {
    fontSize: 11,
    color: theme.textMuted,
  },
  leaderboardScore: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: theme.text,
  },
  // Ring modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.bgCard,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: theme.text,
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  challengeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  challengeTypeBtn: {
    width: '47%',
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  challengeTypeEmoji: {
    fontSize: 32,
  },
  challengeTypeLabel: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: theme.text,
  },
  // Group menu styles
  menuList: {
    gap: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: theme.text,
  },
});
