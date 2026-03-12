import React, { useCallback, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, RefreshControl, Alert, Share, Animated, Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, MoreHorizontal } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing } from '@/constants/spacing';
import { useApp } from '@/providers/AppProvider';
import ReportModal from '@/components/ReportModal';
import { api, blockUser, getSpotlight } from '@/services/api';
import { Skeleton, SnapCardSkeleton } from '@/components/ui';
import { ApiGroupDetail, ApiChallenge, ApiChallengeResponse, ApiSpotlight } from '@/types/api';
import { apiGroupDetailToGroup, apiResponseToSnap, apiSpotlightToUI, apiMembersToLeaderboard } from '@/utils/adapters';
import { isDemoGroup, DEMO_GROUP_DETAIL, DEMO_CHALLENGE, DEMO_RESPONSES } from '@/constants/demoData';
import { useOnboardingStore, tourMessages } from '@/stores/onboardingStore';
import Tooltip, { TargetLayout } from '@/components/Tooltip';
import StreakCelebration from '@/components/StreakCelebration';
import AiPersonalityPill from '@/components/AiPersonalityPill';
import { getSocket } from '@/services/socket';
import { EmptyState, ErrorState } from '@/components/ui';

import {
  MemberAvatarRow,
  ChallengeSection,
  ChallengeTypeSelector,
  PhotoTimeline,
  GroupSettingsModal,
  ChallengeResponsesList,
  BottomActions,
} from '@/components/group-detail';
import type { ChallengeType, ProgressData, GroupPhoto } from '@/components/group-detail';

const SCREEN_WIDTH = Dimensions.get('window').width;

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

  // ── Local state ──
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
  const [streakCelebration, setStreakCelebration] = useState<{ userName: string; streakDays: number } | null>(null);
  const [aiCommentary, setAiCommentary] = useState<{ challengeId: string; commentary: string } | null>(null);
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [previewData, setPreviewData] = useState<{
    respondedCount: number;
    totalMembers: number;
    totalReactions: number;
    topReactionEmoji?: string;
    respondedUsers: Array<{ displayName: string; avatarUrl?: string }>;
  } | null>(null);

  // ── Animations ──
  const scrollY = useRef(new Animated.Value(0)).current;
  const headerTranslateY = scrollY.interpolate({ inputRange: [0, 80], outputRange: [0, -10], extrapolate: 'clamp' });
  const headerOpacity = scrollY.interpolate({ inputRange: [0, 80], outputRange: [1, 0.85], extrapolate: 'clamp' });
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  // ── Data queries ──
  const groupQuery = useQuery({
    queryKey: ['group', id],
    queryFn: async () => {
      if (isDemo) return DEMO_GROUP_DETAIL;
      return await api(`/groups/${id}`) as ApiGroupDetail;
    },
    enabled: !!id,
    staleTime: isDemo ? Infinity : 15_000,
  });

  const challengeQuery = useQuery({
    queryKey: ['challenge', id],
    queryFn: async () => {
      if (isDemo) return { ...DEMO_CHALLENGE, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
      return await api(`/challenges/groups/${id}/challenges/active`) as ApiChallenge;
    },
    enabled: !!id,
    retry: false,
    staleTime: isDemo ? Infinity : undefined,
  });

  const activeChallenge = challengeQuery.data ?? null;

  const responsesQuery = useQuery({
    queryKey: ['responses', isDemo ? 'demo' : activeChallenge?.id],
    queryFn: async () => {
      if (isDemo) return DEMO_RESPONSES;
      if (!activeChallenge?.id) return [];
      return await api(`/challenges/${activeChallenge.id}/responses`) as ApiChallengeResponse[];
    },
    enabled: isDemo ? !!id : !!activeChallenge?.id,
    staleTime: isDemo ? Infinity : undefined,
  });

  const photosQuery = useQuery({
    queryKey: ['group-photos', id],
    queryFn: async () => (await api(`/challenges/groups/${id}/photos?limit=30`) ?? []) as GroupPhoto[],
    enabled: !!id && !isDemo,
    staleTime: 60_000,
    retry: false,
  });

  const spotlightQuery = useQuery({
    queryKey: ['spotlight', id],
    queryFn: async () => await getSpotlight(id!) as ApiSpotlight | null,
    enabled: !!id && !isDemo,
    staleTime: 60_000,
    retry: false,
  });

  // ── Derived data ──
  const group = groupQuery.data ? apiGroupDetailToGroup(groupQuery.data, activeChallenge) : null;
  const leaderboard = groupQuery.data?.members ? apiMembersToLeaderboard(groupQuery.data.members) : [];
  const groupPhotos: GroupPhoto[] = photosQuery.data ?? [];
  const spotlight = spotlightQuery.data ? apiSpotlightToUI(spotlightQuery.data, id) : null;
  const snaps = (responsesQuery.data ?? []).map((r) => ({ ...apiResponseToSnap(r), groupId: id ?? '' }));
  const hasSubmittedToday = isDemo ? false : (
    snaps.some((s) => s.userId === user.id) ||
    (responsesQuery.data ?? []).some((r) => r.user_id === user.id)
  );
  const isQuizChallenge = !!(activeChallenge?.type && activeChallenge.type !== 'snap');

  const challengeTriggerInfo = React.useMemo(() => {
    if (!activeChallenge) return null;
    if (!activeChallenge.triggered_by) return { isAi: true as const, name: 'Blink AI' };
    const member = groupQuery.data?.members?.find((m) => m.user_id === activeChallenge.triggered_by);
    return { isAi: false as const, name: member?.display_name ?? 'Someone' };
  }, [activeChallenge, groupQuery.data?.members]);

  const quizOptions: string[] = React.useMemo(() => {
    if (!isQuizChallenge || !activeChallenge) return [];
    const opts = activeChallenge.options_json ?? activeChallenge.options ?? [];
    if (typeof opts === 'string') { try { return JSON.parse(opts); } catch { return []; } }
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
      label: opt, count: counts[i],
      percentage: total > 0 ? Math.round((counts[i] / total) * 100) : 0,
      respondents: respondents[i] ?? [],
    }));
  }, [responsesQuery.data, quizOptions, isQuizChallenge]);

  const respondedUserIds = React.useMemo(() => {
    const ids = new Set<string>();
    if (responsesQuery.data) for (const r of responsesQuery.data) ids.add(r.user_id);
    if (progressData?.responded) for (const r of progressData.responded) ids.add(r.userId);
    return ids;
  }, [responsesQuery.data, progressData]);

  const isAdmin = group
    ? group.members.some((m) => m.id === user.id && m.role === 'admin') || group.createdBy === user.id
    : false;

  const groupStreak = group
    ? group.members.reduce((min, m) => Math.min(min, m.streak), group.members[0]?.streak ?? 0) : 0;
  const longestGroupStreak = group
    ? Math.max(...group.members.map((m) => m.streak), 0) : 0;

  if (__DEV__ && group) {
    console.log('[GroupDetail] isAdmin:', isAdmin, '| user.id:', user.id, '| createdBy:', group.createdBy);
  }

  // ── Side effects: fetch progress, preview, socket listeners ──
  useEffect(() => {
    if (!activeChallenge?.id || isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ responded?: Array<{ userId: string; displayName: string; avatarUrl?: string }>; totalMembers?: number }>(`/challenges/${activeChallenge.id}/progress`);
        if (!cancelled && data) setProgressData({ responded: data.responded ?? [], totalMembers: data.totalMembers ?? 0 });
      } catch { /* endpoint may not exist */ }
    })();
    return () => { cancelled = true; };
  }, [activeChallenge?.id, isDemo]);

  useEffect(() => {
    if (!activeChallenge?.id || isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ respondedCount?: number; totalMembers?: number; totalReactions?: number; topReactionEmoji?: string; respondedUsers?: Array<{ userId: string; displayName: string; avatarUrl?: string }> }>(`/challenges/${activeChallenge.id}/preview`);
        if (!cancelled && data) setPreviewData({
          respondedCount: data.respondedCount ?? 0, totalMembers: data.totalMembers ?? 0,
          totalReactions: data.totalReactions ?? 0, topReactionEmoji: data.topReactionEmoji,
          respondedUsers: data.respondedUsers ?? [],
        });
      } catch { /* endpoint may not exist */ }
    })();
    return () => { cancelled = true; };
  }, [activeChallenge?.id, isDemo]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || isDemo) return;
    const handleProgress = (data: { responded?: Array<{ userId: string; displayName: string; avatarUrl?: string }>; totalMembers?: number }) => {
      if (data.responded && data.totalMembers) setProgressData({ responded: data.responded, totalMembers: data.totalMembers });
    };
    const handleResponse = () => {
      if (activeChallenge?.id) {
        responsesQuery.refetch();
        api<{ responded?: Array<{ userId: string; displayName: string; avatarUrl?: string }>; totalMembers?: number }>(`/challenges/${activeChallenge.id}/progress`).then((data) => {
          if (data) setProgressData({ responded: data.responded ?? [], totalMembers: data.totalMembers ?? 0 });
        }).catch(() => {});
      }
    };
    const handleStreak = (data: { userName?: string; streakDays?: number }) => {
      if (data.userName && data.streakDays) {
        setStreakCelebration({ userName: data.userName, streakDays: data.streakDays });
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    };
    const handleCommentary = (data: { challengeId?: string; commentary?: string }) => {
      if (data.challengeId && data.commentary) setAiCommentary({ challengeId: data.challengeId, commentary: data.commentary });
    };
    socket.on('challenge:progress', handleProgress);
    socket.on('challenge:response', handleResponse);
    socket.on('streak:milestone', handleStreak);
    socket.on('challenge:commentary', handleCommentary);
    return () => {
      socket.off('challenge:progress', handleProgress);
      socket.off('challenge:response', handleResponse);
      socket.off('streak:milestone', handleStreak);
      socket.off('challenge:commentary', handleCommentary);
    };
  }, [isDemo, activeChallenge?.id, responsesQuery]);

  // ── Mutations ──
  const ringMutation = useMutation({
    mutationFn: async (type: ChallengeType) => {
      return api<{ id?: string; prompt_text?: string; prompt?: string; options_json?: string[]; options?: string[]; expires_at?: string }>(`/challenges/groups/${id}/challenges`, { method: 'POST', body: JSON.stringify({ type }) });
    },
    onSuccess: (data, type) => {
      queryClient.invalidateQueries({ queryKey: ['challenge', id] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setShowRingModal(false);
      if (type === 'snap') {
        router.push({ pathname: '/snap-challenge' as never, params: { groupId: id } });
      } else if (type === 'quiz_food' || type === 'quiz_most_likely' || type === 'quiz_rate_day') {
        router.push({ pathname: '/quiz-challenge' as never, params: { groupId: id, challengeId: data?.id ?? '', type, promptText: data?.prompt_text ?? data?.prompt ?? '', optionsJson: JSON.stringify(data?.options_json ?? data?.options ?? []), expiresAt: data?.expires_at ?? '' } });
      } else {
        router.push({ pathname: '/group-prompt' as never, params: { groupId: id } });
      }
    },
    onError: (error: Error) => Alert.alert('Error', error.message || 'Failed to create challenge'),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { await api(`/groups/${id}`, { method: 'DELETE' }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.removeQueries({ queryKey: ['group', id] });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      router.back();
    },
    onError: (err: Error) => Alert.alert('Error', err.message || 'Failed to delete group'),
  });

  // ── Event handlers ──
  const handleSnapChallenge = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (isDemo) { advanceTour('fab'); router.back(); return; }
    if (activeChallenge?.type === 'snap') {
      router.push({ pathname: '/snap-challenge' as never, params: { groupId: id } });
    } else if (activeChallenge?.type === 'quiz' || activeChallenge?.type === 'quiz_food' || activeChallenge?.type === 'quiz_most_likely' || activeChallenge?.type === 'quiz_rate_day') {
      router.push({ pathname: '/quiz-challenge' as never, params: { groupId: id, challengeId: activeChallenge.id, type: activeChallenge.type, promptText: activeChallenge.prompt_text ?? activeChallenge.prompt ?? '', optionsJson: JSON.stringify(activeChallenge.options_json ?? activeChallenge.options ?? []), expiresAt: activeChallenge.expires_at } });
    } else {
      router.push({ pathname: '/group-prompt' as never, params: { groupId: id } });
    }
  }, [router, id, activeChallenge, isDemo, advanceTour]);

  const handleReaction = useCallback((snapId: string, emoji: string) => addReaction(snapId, emoji), [addReaction]);

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
        responsesQuery.refetch();
      } catch { Alert.alert('Error', 'Could not block user. Please try again.'); }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Block ${userName}?\n\nYou won't see their content and they won't see yours.`)) doBlock();
    } else {
      Alert.alert(`Block ${userName}?`, "You won't see their content and they won't see yours.", [
        { text: 'Cancel', style: 'cancel' }, { text: 'Block', style: 'destructive', onPress: doBlock },
      ]);
    }
  }, [responsesQuery]);

  const handleDeleteGroup = useCallback(() => {
    setShowGroupMenu(false);
    setTimeout(() => {
      if (Platform.OS === 'web') {
        if (window.confirm('Delete Group?\n\nAre you sure? This action cannot be undone and all members will lose access.')) deleteMutation.mutate();
      } else {
        Alert.alert('Delete Group', 'Are you sure? This action cannot be undone and all members will lose access.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
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
        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to leave group');
      }
    };
    setTimeout(() => {
      if (Platform.OS === 'web') { if (window.confirm('Leave Group?\n\nAre you sure? You will need an invite to rejoin.')) doLeave(); }
      else { Alert.alert('Leave Group', 'Are you sure? You will need an invite to rejoin.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: doLeave }]); }
    }, 300);
  }, [id, queryClient, router]);

  const handleShareGroup = useCallback(() => {
    setShowGroupMenu(false);
    Share.share({ message: `Join my group "${group?.name}" on Blink! Use invite code: ${group?.inviteCode}` });
  }, [group?.name, group?.inviteCode]);

  const onRefresh = useCallback(() => {
    if (isDemo) return;
    groupQuery.refetch(); challengeQuery.refetch(); spotlightQuery.refetch();
    if (activeChallenge?.id) responsesQuery.refetch();
  }, [groupQuery, challengeQuery, responsesQuery, spotlightQuery, activeChallenge, isDemo]);

  // ── Countdown timer ──
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

  // ── Tour tooltip measurement ──
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

  const handleGroupDetailTourNext = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    advanceTour('fab'); router.back();
  }, [advanceTour, router]);

  // ── Loading / Error / Empty states ──
  if (groupQuery.isLoading) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><ArrowLeft size={22} color={theme.text} /></TouchableOpacity>
          <View style={s.headerCenter}><Skeleton variant="text" width={120} height={20} /></View>
          <View style={{ width: 36 }} />
        </View>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.lg }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} variant="circle" width={50} height={50} />)}
          </View>
          <Skeleton variant="text" width={SCREEN_WIDTH - 64} height={100} borderRadius={20} />
          <SnapCardSkeleton />
        </View>
      </View>
    );
  }

  if (groupQuery.isError) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><ArrowLeft size={22} color={theme.text} /></TouchableOpacity>
        </View>
        <ErrorState message="Failed to load group details" onRetry={() => groupQuery.refetch()} />
      </View>
    );
  }

  if (!group) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><ArrowLeft size={22} color={theme.text} /></TouchableOpacity>
        </View>
        <EmptyState emoji={"\u{1F605}"} title="Group not found" subtitle="It may have been deleted or you lost access." />
      </View>
    );
  }

  // ── Main render ──
  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Animated.View style={[s.header, { transform: [{ translateY: headerTranslateY }], opacity: headerOpacity }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="back-btn">
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <TouchableOpacity style={s.headerCenter} activeOpacity={0.7} onPress={() => { if (!isDemo) { /* navigate to group settings */ } }}>
          <Text style={s.headerEmoji}>{group.emoji}</Text>
          <Text style={s.headerTitle} numberOfLines={1}>{group.name}</Text>
        </TouchableOpacity>
        <View style={s.headerRight}>
          {!isDemo && (
            <TouchableOpacity style={s.menuBtn} onPress={() => setShowGroupMenu(true)}>
              <MoreHorizontal size={20} color={theme.text} />
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      <Animated.ScrollView
        style={s.scrollView}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={!isDemo && groupQuery.isRefetching} onRefresh={onRefresh} tintColor={theme.coral} />}
      >
        <MemberAvatarRow
          members={group.members.map((m) => ({ id: m.id, name: m.name, avatar: m.avatar }))}
          respondedUserIds={respondedUserIds}
          hasActiveChallenge={group.hasActiveChallenge}
        />

        {group.aiPersonality && (
          <View style={s.personalityRow}><AiPersonalityPill personality={group.aiPersonality} /></View>
        )}

        {activeChallenge && (
          <ChallengeSection
            activeChallenge={activeChallenge}
            challengeTriggerInfo={challengeTriggerInfo}
            isQuizChallenge={isQuizChallenge}
            hasSubmittedToday={hasSubmittedToday}
            countdown={countdown}
            pulseAnim={pulseAnim}
            progressData={progressData}
            currentUserId={user.id}
            onRespond={handleSnapChallenge}
            challengeBarRef={challengeBarRef}
          />
        )}

        <ChallengeResponsesList
          activeChallenge={activeChallenge}
          isDemo={isDemo}
          responsesLoading={responsesQuery.isLoading}
          responsesError={responsesQuery.isError}
          responsesData={responsesQuery.data}
          onRetryResponses={() => responsesQuery.refetch()}
          isQuizChallenge={isQuizChallenge}
          hasSubmittedToday={hasSubmittedToday}
          quizDistribution={quizDistribution}
          currentUserId={user.id}
          snaps={snaps}
          groupPhotosCount={groupPhotos.length}
          groupMemberCount={group.members.length}
          spotlight={spotlight}
          previewData={previewData}
          progressData={progressData}
          aiCommentary={aiCommentary}
          onRespond={handleSnapChallenge}
          onReact={handleReaction}
          onReport={handleReportSnap}
          onBlock={handleBlockUser}
        />

        {!isDemo && (
          <PhotoTimeline
            photos={groupPhotos}
            groupId={id ?? ''}
            onSeeAll={() => router.push({ pathname: '/challenge-history' as never, params: { groupId: id } })}
          />
        )}

        <BottomActions
          isDemo={isDemo}
          hasActiveChallenge={!!activeChallenge}
          groupStreak={groupStreak}
          longestGroupStreak={longestGroupStreak}
          leaderboardCount={leaderboard.length}
          onChallengeNow={() => {
            if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            setShowRingModal(true);
          }}
          onViewLeaderboard={() => router.push({ pathname: '/group-leaderboard' as never, params: { groupId: id } })}
        />

        <View style={{ height: 100 }} />
      </Animated.ScrollView>

      <Tooltip
        visible={isDemo && tourStep === 'group_detail'}
        message={tourMessages.group_detail}
        targetLayout={challengeBarLayout}
        position="below"
        onNext={handleGroupDetailTourNext}
        onDismiss={completeTour}
        nextLabel="Got it"
        step={2}
        totalSteps={3}
      />

      <ChallengeTypeSelector
        visible={showRingModal}
        isPending={ringMutation.isPending}
        onClose={() => setShowRingModal(false)}
        onSelect={(type) => ringMutation.mutate(type)}
      />

      <GroupSettingsModal
        visible={showGroupMenu}
        groupName={group.name}
        groupId={id ?? ''}
        isAdmin={isAdmin}
        onClose={() => setShowGroupMenu(false)}
        onInviteMembers={() => { setShowGroupMenu(false); router.push({ pathname: '/invite-members' as never, params: { groupId: id } }); }}
        onShareGroup={handleShareGroup}
        onDeleteGroup={handleDeleteGroup}
        onLeaveGroup={handleLeaveGroup}
        onReportGroup={() => { setShowGroupMenu(false); setReportTarget({ contentType: 'group', reportedContentId: id }); setShowReportModal(true); }}
      />

      <ReportModal
        visible={showReportModal}
        onClose={() => setShowReportModal(false)}
        reportedUserId={reportTarget.reportedUserId}
        reportedContentId={reportTarget.reportedContentId}
        contentType={reportTarget.contentType}
      />

      <StreakCelebration
        visible={!!streakCelebration}
        userName={streakCelebration?.userName ?? ''}
        streakDays={streakCelebration?.streakDays ?? 0}
        onDismiss={() => setStreakCelebration(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.bgCard, justifyContent: 'center', alignItems: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginHorizontal: spacing.sm },
  headerEmoji: { fontSize: 24 },
  headerTitle: { ...typography.headlineLarge, color: theme.text, maxWidth: 180 },
  headerRight: { width: 38, alignItems: 'flex-end' },
  menuBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.bgCard, justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  personalityRow: { flexDirection: 'row', marginBottom: spacing.md },
});
