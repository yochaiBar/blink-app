import React, { useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  RefreshControl,
  Alert,
  Share,
  Animated,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, MoreHorizontal } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing } from '@/constants/spacing';
import { useApp } from '@/providers/AppProvider';
import ReportModal from '@/components/ReportModal';
import { api, blockUser, resetGroupKey } from '@/services/api';
import { newGroupKey, storeGroupKey } from '@/services/groupCrypto';
import { Skeleton, SnapCardSkeleton } from '@/components/ui';
import { apiGroupDetailToGroup, apiResponseToSnap, apiMembersToLeaderboard } from '@/utils/adapters';
import {
  useGroupDetail,
  fetchChallengeProgress,
  fetchChallengePreview,
  type ChallengePreview,
} from '@/hooks/useGroupDetail';
import { useOnboardingStore, tourMessages } from '@/stores/onboardingStore';
import Tooltip, { TargetLayout } from '@/components/Tooltip';
import StreakCelebration from '@/components/StreakCelebration';
import { getSocket } from '@/services/socket';
import { EmptyState, ErrorState } from '@/components/ui';

import {
  MemberAvatarRow,
  ChallengeSection,
  GroupSettingsModal,
  ChallengeResponsesList,
  BottomActions,
  GroupMiniFeed,
  GroupStatsCard,
} from '@/components/group-detail';
import type { ProgressData } from '@/components/group-detail';

const SCREEN_WIDTH = Dimensions.get('window').width;

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { addReaction, user } = useApp();

  const tourStep = useOnboardingStore((s) => s.tourStep);
  const advanceTour = useOnboardingStore((s) => s.advanceTour);
  const completeTour = useOnboardingStore((s) => s.completeTour);

  // ── Local state ──
  const [countdown, setCountdown] = useState<string>('');
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
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [previewData, setPreviewData] = useState<ChallengePreview | null>(null);
  const [challengeJustTriggered, setChallengeJustTriggered] = useState(false);

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

  // ── Data queries (the demo group is served by demoSource behind this hook) ──
  const { isSample, groupQuery, challengeQuery, activeChallenge, responsesQuery, photosQuery } = useGroupDetail(id);

  // ── Derived data ──
  const group = groupQuery.data ? apiGroupDetailToGroup(groupQuery.data, activeChallenge) : null;
  const leaderboard = groupQuery.data?.members ? apiMembersToLeaderboard(groupQuery.data.members) : [];
  const groupPhotosCount = photosQuery.data?.length ?? 0;
  const snaps = (responsesQuery.data ?? []).map((r) => ({ ...apiResponseToSnap(r), groupId: id ?? '' }));
  const hasSubmittedToday = (responsesQuery.data ?? []).some((r) => r.user_id === user.id);
  const challengeStarterName = React.useMemo(() => {
    if (!activeChallenge?.created_by) return null;
    const member = groupQuery.data?.members?.find((m) => m.user_id === activeChallenge.created_by);
    return member?.display_name ?? 'Someone';
  }, [activeChallenge, groupQuery.data?.members]);

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
    ? group.members.reduce((min, m) => Math.min(min, m.streak), group.members[0]?.streak ?? 0)
    : 0;
  const longestGroupStreak = group ? Math.max(...group.members.map((m) => m.streak), 0) : 0;

  // ── Side effects: fetch progress, preview, socket listeners ──
  useEffect(() => {
    if (!activeChallenge?.id) return;
    let cancelled = false;
    fetchChallengeProgress(activeChallenge.id)
      .then((data) => {
        if (!cancelled && data) {
          setProgressData({ responded: data.respondedUsers ?? [], totalMembers: data.totalMembers ?? 0 });
          setChallengeJustTriggered(false);
        }
      })
      .catch(() => {}); // Non-critical: progress is supplementary
    return () => {
      cancelled = true;
    };
  }, [activeChallenge?.id]);

  useEffect(() => {
    if (!activeChallenge?.id) return;
    let cancelled = false;
    fetchChallengePreview(activeChallenge.id)
      .then((data) => {
        if (!cancelled && data)
          setPreviewData({
            respondedCount: data.respondedCount ?? 0,
            totalMembers: data.totalMembers ?? 0,
            totalReactions: data.totalReactions ?? 0,
            topReactionEmoji: data.topReactionEmoji,
            respondedUsers: data.respondedUsers ?? [],
          });
      })
      .catch(() => {}); // Non-critical: the teaser is supplementary
    return () => {
      cancelled = true;
    };
  }, [activeChallenge?.id]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handleProgress = (data: {
      respondedUsers?: { userId: string; displayName: string }[];
      totalMembers?: number;
    }) => {
      if (data.respondedUsers && data.totalMembers) {
        setProgressData({ responded: data.respondedUsers, totalMembers: data.totalMembers });
        setChallengeJustTriggered(false);
      }
    };
    const handleResponse = () => {
      if (activeChallenge?.id) {
        responsesQuery.refetch();
        fetchChallengeProgress(activeChallenge.id)
          .then((data) => {
            if (data) setProgressData({ responded: data.respondedUsers ?? [], totalMembers: data.totalMembers ?? 0 });
          })
          .catch(() => {}); // Non-critical: progress refresh is best-effort
      }
    };
    const handleStreak = (data: { userName?: string; streakDays?: number }) => {
      if (data.userName && data.streakDays) {
        setStreakCelebration({ userName: data.userName, streakDays: data.streakDays });
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    };
    socket.on('challenge:progress', handleProgress);
    socket.on('challenge:response', handleResponse);
    socket.on('streak:milestone', handleStreak);
    return () => {
      socket.off('challenge:progress', handleProgress);
      socket.off('challenge:response', handleResponse);
      socket.off('streak:milestone', handleStreak);
    };
  }, [activeChallenge?.id, responsesQuery]);

  // ── Mutations ──
  const ringMutation = useMutation({
    // Every challenge is a snap; the server picks the prompt.
    mutationFn: async () => api(`/challenges/groups/${id}/challenges`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['challenge', id] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });

      // Optimistic UI: show challenge started state without inflating the response count
      const memberCount = groupQuery.data?.members?.length ?? group?.memberCount ?? group?.members.length ?? 0;
      setChallengeJustTriggered(true);
      setProgressData({
        responded: [],
        totalMembers: memberCount,
      });
      setPreviewData({
        respondedCount: 0,
        totalMembers: memberCount,
        totalReactions: 0,
        respondedUsers: [],
      });

      router.push({ pathname: '/snap-challenge' as never, params: { groupId: id } });
    },
    onError: (error: Error) => Alert.alert('Error', error.message || 'Failed to create challenge'),
  });

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
    onError: (err: Error) => Alert.alert('Error', err.message || 'Failed to delete group'),
  });

  // ── Event handlers ──
  const handleSnapChallenge = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    router.push({ pathname: '/snap-challenge' as never, params: { groupId: id } });
  }, [router, id]);

  // Two-step start (tap, then confirm) as before, now that there is no type picker.
  const handleChallengeNow = useCallback(() => {
    if (ringMutation.isPending) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const msg = 'Everyone in the group gets a few minutes to snap a photo.';
    if (Platform.OS === 'web') {
      if (window.confirm(`Start a snap challenge?\n\n${msg}`)) ringMutation.mutate();
      return;
    }
    Alert.alert('Start a snap challenge?', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start', onPress: () => ringMutation.mutate() },
    ]);
  }, [ringMutation]);

  const handleReaction = useCallback((snapId: string, emoji: string) => addReaction(snapId, emoji), [addReaction]);

  const handleReportSnap = useCallback((snapId: string, userId: string) => {
    setReportTarget({ contentType: 'challenge_response', reportedContentId: snapId, reportedUserId: userId });
    setShowReportModal(true);
  }, []);

  const handleBlockUser = useCallback(
    (userId: string, userName: string) => {
      const doBlock = async () => {
        try {
          await blockUser(userId);
          if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Blocked', `${userName} has been blocked. You won't see their content anymore.`);
          responsesQuery.refetch();
        } catch {
          Alert.alert('Error', 'Could not block user. Please try again.');
        }
      };
      if (Platform.OS === 'web') {
        if (window.confirm(`Block ${userName}?\n\nYou won't see their content and they won't see yours.`)) doBlock();
      } else {
        Alert.alert(`Block ${userName}?`, "You won't see their content and they won't see yours.", [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Block', style: 'destructive', onPress: doBlock },
        ]);
      }
    },
    [responsesQuery],
  );

  const handleDeleteGroup = useCallback(() => {
    setShowGroupMenu(false);
    setTimeout(() => {
      if (Platform.OS === 'web') {
        if (
          window.confirm(
            'Delete Group?\n\nAre you sure? This action cannot be undone and all members will lose access.',
          )
        )
          deleteMutation.mutate();
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
      if (Platform.OS === 'web') {
        if (window.confirm('Leave Group?\n\nAre you sure? You will need an invite to rejoin.')) doLeave();
      } else {
        Alert.alert('Leave Group', 'Are you sure? You will need an invite to rejoin.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: doLeave },
        ]);
      }
    }, 300);
  }, [id, queryClient, router]);

  const handleResetKey = useCallback(() => {
    setShowGroupMenu(false);
    const doReset = async () => {
      if (!id) return;
      try {
        // Server bumps the version (it never sees the key); we mint a fresh
        // key locally at that version. Members pull it via recovery, driven
        // by the `group:key_rotated` fan-out the server emits.
        const { group_key_version } = await resetGroupKey({ group_id: id });
        await storeGroupKey(id, newGroupKey(), group_key_version);
        queryClient.invalidateQueries({ queryKey: ['groups'] });
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Secure Key Reset',
          'A new secure key was generated and is being shared with members who are online. Everyone can send photos again once they reopen Blinks.',
        );
      } catch (err: unknown) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to reset the secure key');
      }
    };
    const msg =
      'This fixes "no group key" errors by generating a brand-new secure key for the group. Photos sent under the old key can no longer be opened. Continue?';
    setTimeout(() => {
      if (Platform.OS === 'web') {
        if (window.confirm(`Reset Secure Key?\n\n${msg}`)) doReset();
      } else {
        Alert.alert('Reset Secure Key', msg, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reset', style: 'destructive', onPress: doReset },
        ]);
      }
    }, 300);
  }, [id, queryClient]);

  const handleShareGroup = useCallback(() => {
    setShowGroupMenu(false);
    Share.share({ message: `Join my group "${group?.name}" on Blink! Use invite code: ${group?.inviteCode}` });
  }, [group?.name, group?.inviteCode]);

  const onRefresh = useCallback(() => {
    groupQuery.refetch();
    challengeQuery.refetch();
    if (activeChallenge?.id) responsesQuery.refetch();
  }, [groupQuery, challengeQuery, responsesQuery, activeChallenge]);

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
    if (isSample && tourStep === 'group_detail' && challengeBarRef.current) {
      const timer = setTimeout(() => {
        challengeBarRef.current?.measureInWindow((x, y, width, height) => {
          if (width > 0) setChallengeBarLayout({ x, y, width, height });
        });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isSample, tourStep, group]);

  const handleGroupDetailTourNext = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    advanceTour('fab');
    router.back();
  }, [advanceTour, router]);

  // ── Loading / Error / Empty states ──
  if (groupQuery.isLoading) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Skeleton variant="text" width={120} height={20} />
          </View>
          <View style={{ width: 36 }} />
        </View>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.lg }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} variant="circle" width={50} height={50} />
            ))}
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
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
        <ErrorState message="Failed to load group details" onRetry={() => groupQuery.refetch()} />
      </View>
    );
  }

  if (!group) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
        <EmptyState
          emoji={'\u{1F605}'}
          title="Group not found"
          subtitle="It may have been deleted or you lost access."
        />
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
        <View style={s.headerCenter}>
          <Text style={s.headerEmoji}>{group.emoji}</Text>
          <Text style={s.headerTitle} numberOfLines={1}>
            {group.name}
          </Text>
        </View>
        <View style={s.headerRight}>
          {/* A sample group has no settings: nothing to invite to, leave or delete. */}
          {!isSample && (
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
        refreshControl={
          <RefreshControl refreshing={groupQuery.isRefetching} onRefresh={onRefresh} tintColor={theme.coral} />
        }
      >
        <MemberAvatarRow
          members={(groupQuery.data?.members ?? []).map((m) => ({
            id: m.user_id,
            name: m.display_name ?? 'User',
            avatar: m.avatar_url ?? '',
          }))}
          respondedUserIds={respondedUserIds}
          hasActiveChallenge={group.hasActiveChallenge}
          currentUserId={user.id}
        />

        {!isSample && id && <GroupStatsCard groupId={id} />}

        {activeChallenge && (
          <ChallengeSection
            activeChallenge={activeChallenge}
            challengeStarterName={challengeStarterName}
            hasSubmittedToday={hasSubmittedToday}
            countdown={countdown}
            pulseAnim={pulseAnim}
            progressData={progressData}
            currentUserId={user.id}
            onRespond={handleSnapChallenge}
            challengeBarRef={challengeBarRef}
            challengeJustTriggered={challengeJustTriggered}
          />
        )}

        <ChallengeResponsesList
          activeChallenge={activeChallenge}
          showTeaser={!isSample}
          responsesLoading={responsesQuery.isLoading}
          responsesError={responsesQuery.isError}
          onRetryResponses={() => responsesQuery.refetch()}
          hasSubmittedToday={hasSubmittedToday}
          currentUserId={user.id}
          snaps={snaps}
          groupPhotosCount={groupPhotosCount}
          groupMemberCount={groupQuery.data?.members?.length ?? group.memberCount ?? group.members.length}
          previewData={previewData}
          progressData={progressData}
          challengeJustTriggered={challengeJustTriggered}
          onRespond={handleSnapChallenge}
          onReact={handleReaction}
          onReport={handleReportSnap}
          onBlock={handleBlockUser}
        />

        {/* A sample group has no history: no recent activity, streaks, leaderboard or new challenges. */}
        {!isSample && <GroupMiniFeed groupId={id ?? ''} groupName={group.name} groupEmoji={group.emoji} />}

        {!isSample && (
          <BottomActions
            hasActiveChallenge={!!activeChallenge}
            groupStreak={groupStreak}
            longestGroupStreak={longestGroupStreak}
            leaderboardCount={leaderboard.length}
            isStartingChallenge={ringMutation.isPending}
            onChallengeNow={handleChallengeNow}
            onViewLeaderboard={() => router.push({ pathname: '/group-leaderboard' as never, params: { groupId: id } })}
          />
        )}

        <View style={{ height: 100 }} />
      </Animated.ScrollView>

      <Tooltip
        visible={isSample && tourStep === 'group_detail'}
        message={tourMessages.group_detail}
        targetLayout={challengeBarLayout}
        position="below"
        onNext={handleGroupDetailTourNext}
        onDismiss={completeTour}
        nextLabel="Got it"
        step={2}
        totalSteps={3}
      />

      <GroupSettingsModal
        visible={showGroupMenu}
        groupName={group.name}
        groupId={id ?? ''}
        isAdmin={isAdmin}
        onClose={() => setShowGroupMenu(false)}
        onInviteMembers={() => {
          setShowGroupMenu(false);
          router.push({ pathname: '/invite-members' as never, params: { groupId: id } });
        }}
        onShareGroup={handleShareGroup}
        onDeleteGroup={handleDeleteGroup}
        onLeaveGroup={handleLeaveGroup}
        onResetKey={handleResetKey}
        onReportGroup={() => {
          setShowGroupMenu(false);
          setReportTarget({ contentType: 'group', reportedContentId: id });
          setShowReportModal(true);
        }}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
  },
  headerEmoji: { fontSize: 24 },
  headerTitle: { ...typography.headlineLarge, color: theme.text, maxWidth: 180 },
  headerRight: { width: 38, alignItems: 'flex-end' },
  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
});
