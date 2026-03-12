import React, { useCallback, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, RefreshControl, Modal, Alert, Share, Animated, Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { ArrowLeft, Camera, ChevronRight, Flame, MoreHorizontal, Share2, Trophy, UserPlus, Zap, X, LogOut, Trash2, Clock, Flag } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import { useApp } from '@/providers/AppProvider';
import SnapCard from '@/components/SnapCard';
import SpotlightCard from '@/components/SpotlightCard';
import ReportModal from '@/components/ReportModal';
import { categoryLabels } from '@/constants/categories';
import { api, blockUser, getSpotlight } from '@/services/api';
import { Users } from 'lucide-react-native';
import { Skeleton, SnapCardSkeleton, EmptyState, ErrorState } from '@/components/ui';
import GlassCard from '@/components/ui/GlassCard';
import AvatarRing from '@/components/ui/AvatarRing';
import { ApiGroupDetail, ApiChallenge, ApiChallengeResponse, ApiSpotlight } from '@/types/api';
import { apiGroupDetailToGroup, apiResponseToSnap, apiSpotlightToUI, apiMembersToLeaderboard } from '@/utils/adapters';
import { isDemoGroup, DEMO_GROUP_DETAIL, DEMO_CHALLENGE, DEMO_RESPONSES } from '@/constants/demoData';
import { useOnboardingStore, tourMessages } from '@/stores/onboardingStore';
import Tooltip, { TargetLayout } from '@/components/Tooltip';
import ActivityPulse from '@/components/ActivityPulse';
import GroupStreakBanner from '@/components/GroupStreakBanner';
import BlurredPreviewCard from '@/components/BlurredPreviewCard';
import StreakCelebration from '@/components/StreakCelebration';
import BlinkAiAvatar from '@/components/BlinkAiAvatar';
import AiCommentaryCard from '@/components/AiCommentaryCard';
import AiPersonalityPill from '@/components/AiPersonalityPill';
import { getSocket } from '@/services/socket';
import { AiPersonality } from '@/types';

type ChallengeType = 'snap' | 'quiz' | 'quiz_food' | 'quiz_most_likely' | 'quiz_rate_day';

const challengeTypes: { type: ChallengeType; emoji: string; label: string }[] = [
  { type: 'snap', emoji: '\u{1F4F8}', label: 'Snap Challenge' },
  { type: 'quiz_food', emoji: '\u{1F354}', label: 'Food Quiz' },
  { type: 'quiz_most_likely', emoji: '\u{1F440}', label: 'Most Likely To' },
  { type: 'quiz_rate_day', emoji: '\u2B50', label: 'Rate Your Day' },
];

const SCREEN_WIDTH = Dimensions.get('window').width;
const THUMB_COLS = 3;
const THUMB_GAP = spacing.xs;
const THUMB_SIZE = (SCREEN_WIDTH - spacing.lg * 2 - THUMB_GAP * (THUMB_COLS - 1)) / THUMB_COLS;

// Helper: get challenge type config
function getChallengeTypeConfig(type: string): { emoji: string; label: string } {
  const typeMap: Record<string, { emoji: string; label: string }> = {
    snap: { emoji: '\u{1F4F8}', label: 'Snap' },
    quiz_food: { emoji: '\u{1F354}', label: 'Food' },
    quiz_most_likely: { emoji: '\u{1F440}', label: 'Most Likely' },
    quiz_rate_day: { emoji: '\u2B50', label: 'Rate Day' },
    quiz: { emoji: '\u{1F9E0}', label: 'Quiz' },
  };
  return typeMap[type] ?? { emoji: '\u{1F4F8}', label: 'Challenge' };
}

// ----- Member Ring Row sub-component -----
// Animated member avatar with spring bounce on tap
const AnimatedMemberAvatar = React.memo(function AnimatedMemberAvatar({
  member,
  hasResponded,
  hasActiveChallenge,
  isSelected,
  onPress,
}: {
  member: { id: string; name: string; avatar: string };
  hasResponded: boolean;
  hasActiveChallenge: boolean;
  isSelected: boolean;
  onPress: () => void;
}) {
  const springScale = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Animated.sequence([
      Animated.spring(springScale, { toValue: 0.8, useNativeDriver: true, speed: 50, bounciness: 4 }),
      Animated.spring(springScale, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 10 }),
    ]).start();
    onPress();
  }, [onPress, springScale]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={1}
      style={s.memberRingItem}
    >
      <Animated.View style={{ transform: [{ scale: springScale }] }}>
        <AvatarRing
          uri={member.avatar}
          name={member.name}
          size={46}
          hasResponded={hasResponded}
          showStatus={hasActiveChallenge}
          isActive={hasActiveChallenge && !hasResponded}
        />
      </Animated.View>
      {isSelected && (
        <View style={s.memberTooltip}>
          <Text style={s.memberTooltipText} numberOfLines={1}>
            {member.name}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

function MemberRingRow({
  members,
  respondedUserIds,
  hasActiveChallenge,
}: {
  members: Array<{ id: string; name: string; avatar: string }>;
  respondedUserIds: Set<string>;
  hasActiveChallenge: boolean;
}) {
  const [tooltipName, setTooltipName] = useState<string | null>(null);

  const respondedCount = hasActiveChallenge
    ? members.filter((m) => respondedUserIds.has(m.id)).length
    : 0;

  return (
    <View style={s.memberRingSection}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.memberRingRow}
      >
        {members.map((member) => {
          const hasResponded = respondedUserIds.has(member.id);
          return (
            <AnimatedMemberAvatar
              key={member.id}
              member={member}
              hasResponded={hasResponded}
              hasActiveChallenge={hasActiveChallenge}
              isSelected={tooltipName === member.name}
              onPress={() => setTooltipName(tooltipName === member.name ? null : member.name)}
            />
          );
        })}
      </ScrollView>
      {hasActiveChallenge && members.length > 0 && (
        <Text style={s.respondedCount}>
          {respondedCount}/{members.length} responded
        </Text>
      )}
    </View>
  );
}

// ----- Past Challenge Thumbnail Grid -----
interface PastChallenge {
  id: string;
  type: string;
  photo_url?: string | null;
  prompt?: string | null;
}

interface GroupPhoto {
  id: string;
  challenge_id: string;
  photo_url: string;
  responded_at: string;
  prompt: string | null;
  challenge_type: string;
  display_name: string;
  avatar_url: string | null;
}

function getRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function PhotoTimeline({
  photos,
  groupId,
  onSeeAll,
}: {
  photos: GroupPhoto[];
  groupId: string;
  onSeeAll: () => void;
}) {
  const router = useRouter();
  if (photos.length === 0) return null;

  return (
    <View style={s.pastSection}>
      <View style={s.pastHeader}>
        <Text style={[typography.headlineMedium, { color: theme.text }]}>Moments</Text>
        {photos.length > 9 && (
          <TouchableOpacity onPress={onSeeAll} style={s.seeAllBtn}>
            <Text style={s.seeAllText}>See all</Text>
            <ChevronRight size={14} color={theme.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      <View style={s.thumbGrid}>
        {photos.slice(0, 9).map((photo) => (
          <TouchableOpacity
            key={photo.id}
            style={s.thumbItem}
            activeOpacity={0.8}
            onPress={() =>
              router.push({
                pathname: '/challenge-reveal' as never,
                params: { challengeId: photo.challenge_id, groupId },
              })
            }
          >
            <Image
              source={{ uri: photo.photo_url }}
              style={s.thumbImage}
              contentFit="cover"
              transition={200}
            />
            <View style={s.thumbOverlayBottom}>
              <Image
                source={{ uri: photo.avatar_url ?? 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop' }}
                style={s.thumbAvatar}
                contentFit="cover"
              />
              <Text style={s.thumbTime} numberOfLines={1}>{getRelativeTime(photo.responded_at)}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ===========================
// MAIN GROUP DETAIL SCREEN
// ===========================
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

  // Streak celebration state
  const [streakCelebration, setStreakCelebration] = useState<{ userName: string; streakDays: number } | null>(null);

  // AI commentary state
  const [aiCommentary, setAiCommentary] = useState<{ challengeId: string; commentary: string } | null>(null);

  // Challenge progress state for ActivityPulse
  const [progressData, setProgressData] = useState<{
    responded: Array<{ userId: string; displayName: string; avatarUrl?: string }>;
    totalMembers: number;
  } | null>(null);

  // Blurred preview state
  const [previewData, setPreviewData] = useState<{
    respondedCount: number;
    totalMembers: number;
    totalReactions: number;
    topReactionEmoji?: string;
    respondedUsers: Array<{ displayName: string; avatarUrl?: string }>;
  } | null>(null);

  // Scroll-based parallax for header
  const scrollY = useRef(new Animated.Value(0)).current;
  const headerTranslateY = scrollY.interpolate({
    inputRange: [0, 80],
    outputRange: [0, -10],
    extrapolate: 'clamp',
  });
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 80],
    outputRange: [1, 0.85],
    extrapolate: 'clamp',
  });

  // Pulsing timer animation
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

  // Fetch group photo timeline
  const photosQuery = useQuery({
    queryKey: ['group-photos', id],
    queryFn: async () => {
      const data = await api(`/challenges/groups/${id}/photos?limit=30`);
      return (data ?? []) as GroupPhoto[];
    },
    enabled: !!id && !isDemo,
    staleTime: 60_000,
    retry: false,
  });

  const groupPhotos: GroupPhoto[] = photosQuery.data ?? [];

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

  // Fetch past challenges for thumbnail grid
  const pastChallengesQuery = useQuery({
    queryKey: ['challenge-history', id],
    queryFn: async () => {
      const data = await api(`/challenges/groups/${id}/challenges/history?limit=9`);
      return (data ?? []) as PastChallenge[];
    },
    enabled: !!id && !isDemo,
    staleTime: 60_000,
    retry: false,
  });

  const pastChallenges: PastChallenge[] = pastChallengesQuery.data ?? [];

  // Fetch challenge progress for ActivityPulse
  useEffect(() => {
    if (!activeChallenge?.id || isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api(`/challenges/${activeChallenge.id}/progress`);
        if (!cancelled && data) {
          setProgressData({
            responded: data.responded ?? [],
            totalMembers: data.totalMembers ?? 0,
          });
        }
      } catch {
        // Endpoint may not exist yet — silently ignore
      }
    })();
    return () => { cancelled = true; };
  }, [activeChallenge?.id, isDemo]);

  // Fetch blurred preview for non-responded users
  useEffect(() => {
    if (!activeChallenge?.id || isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api(`/challenges/${activeChallenge.id}/preview`);
        if (!cancelled && data) {
          setPreviewData({
            respondedCount: data.respondedCount ?? 0,
            totalMembers: data.totalMembers ?? 0,
            totalReactions: data.totalReactions ?? 0,
            topReactionEmoji: data.topReactionEmoji,
            respondedUsers: data.respondedUsers ?? [],
          });
        }
      } catch {
        // Endpoint may not exist yet — silently ignore
      }
    })();
    return () => { cancelled = true; };
  }, [activeChallenge?.id, isDemo]);

  // Socket listeners for real-time updates
  useEffect(() => {
    const socket = getSocket();
    if (!socket || isDemo) return;

    const handleChallengeProgress = (data: {
      responded?: Array<{ userId: string; displayName: string; avatarUrl?: string }>;
      totalMembers?: number;
    }) => {
      if (data.responded && data.totalMembers) {
        setProgressData({
          responded: data.responded,
          totalMembers: data.totalMembers,
        });
      }
    };

    const handleChallengeResponse = () => {
      // Refresh responses and progress
      if (activeChallenge?.id) {
        responsesQuery.refetch();
        api(`/challenges/${activeChallenge.id}/progress`)
          .then((data) => {
            if (data) {
              setProgressData({
                responded: data.responded ?? [],
                totalMembers: data.totalMembers ?? 0,
              });
            }
          })
          .catch(() => {});
      }
    };

    const handleStreakMilestone = (data: { userName?: string; streakDays?: number }) => {
      if (data.userName && data.streakDays) {
        setStreakCelebration({ userName: data.userName, streakDays: data.streakDays });
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    };

    const handleChallengeCommentary = (data: { challengeId?: string; commentary?: string }) => {
      if (data.challengeId && data.commentary) {
        setAiCommentary({ challengeId: data.challengeId, commentary: data.commentary });
      }
    };

    socket.on('challenge:progress', handleChallengeProgress);
    socket.on('challenge:response', handleChallengeResponse);
    socket.on('streak:milestone', handleStreakMilestone);
    socket.on('challenge:commentary', handleChallengeCommentary);

    return () => {
      socket.off('challenge:progress', handleChallengeProgress);
      socket.off('challenge:response', handleChallengeResponse);
      socket.off('streak:milestone', handleStreakMilestone);
      socket.off('challenge:commentary', handleChallengeCommentary);
    };
  }, [isDemo, activeChallenge?.id, responsesQuery]);

  // Build UI group from API detail
  const group = groupQuery.data
    ? apiGroupDetailToGroup(groupQuery.data, activeChallenge)
    : null;

  // Compute leaderboard from group members
  const leaderboard = groupQuery.data?.members
    ? apiMembersToLeaderboard(groupQuery.data.members)
    : [];

  const snaps = (responsesQuery.data ?? []).map((r) => ({
    ...apiResponseToSnap(r),
    groupId: id ?? '',
  }));

  const hasSubmittedToday = isDemo ? false : (
    snaps.some((s) => s.userId === user.id) ||
    (responsesQuery.data ?? []).some((r) => r.user_id === user.id)
  );

  const isQuizChallenge = activeChallenge?.type && activeChallenge.type !== 'snap';

  // Resolve who triggered the active challenge
  const challengeTriggerInfo = React.useMemo(() => {
    if (!activeChallenge) return null;
    if (!activeChallenge.triggered_by) {
      return { isAi: true as const, name: 'Blink AI' };
    }
    const member = groupQuery.data?.members?.find((m) => m.user_id === activeChallenge.triggered_by);
    return { isAi: false as const, name: member?.display_name ?? 'Someone' };
  }, [activeChallenge, groupQuery.data?.members]);

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

  // Set of user IDs that have responded to the active challenge
  const respondedUserIds = React.useMemo(() => {
    const ids = new Set<string>();
    if (responsesQuery.data) {
      for (const r of responsesQuery.data) {
        ids.add(r.user_id);
      }
    }
    if (progressData?.responded) {
      for (const r of progressData.responded) {
        ids.add(r.userId);
      }
    }
    return ids;
  }, [responsesQuery.data, progressData]);

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
    setTimeout(() => {
      if (Platform.OS === 'web') {
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

  // Compute group streak for banner
  const groupStreak = group
    ? group.members.reduce((min, m) => Math.min(min, m.streak), group.members[0]?.streak ?? 0)
    : 0;
  const longestGroupStreak = group
    ? Math.max(...group.members.map((m) => m.streak), 0)
    : 0;

  // ---- LOADING STATE ----
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
          {/* Avatar ring skeleton */}
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

  // ---- ERROR STATE ----
  if (groupQuery.isError) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
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

  // ---- EMPTY STATE ----
  if (!group) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
        <EmptyState
          emoji="\u{1F605}"
          title="Group not found"
          subtitle="It may have been deleted or you lost access."
        />
      </View>
    );
  }

  // =============================
  // MAIN RENDER
  // =============================
  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* ===== 1. SIMPLIFIED HEADER with parallax ===== */}
      <Animated.View style={[s.header, { transform: [{ translateY: headerTranslateY }], opacity: headerOpacity }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="back-btn">
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>

        <TouchableOpacity
          style={s.headerCenter}
          activeOpacity={0.7}
          onPress={() => {
            if (!isDemo) {
              // Tappable to edit - could navigate to group settings
            }
          }}
        >
          <Text style={s.headerEmoji}>{group.emoji}</Text>
          <Text style={s.headerTitle} numberOfLines={1}>{group.name}</Text>
        </TouchableOpacity>

        <View style={s.headerRight}>
          {!isDemo && (
            <TouchableOpacity style={s.menuBtn} onPress={handleGroupMenu}>
              <MoreHorizontal size={20} color={theme.text} />
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      <Animated.ScrollView
        style={s.scrollView}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={!isDemo && groupQuery.isRefetching}
            onRefresh={onRefresh}
            tintColor={theme.coral}
          />
        }
      >
        {/* ===== 2. MEMBER RING ROW ===== */}
        <MemberRingRow
          members={group.members.map((m) => ({ id: m.id, name: m.name, avatar: m.avatar }))}
          respondedUserIds={respondedUserIds}
          hasActiveChallenge={group.hasActiveChallenge}
        />

        {/* AI Personality pill (subtle) */}
        {group.aiPersonality && (
          <View style={s.personalityRow}>
            <AiPersonalityPill personality={group.aiPersonality} />
          </View>
        )}

        {/* ===== 3. ACTIVE CHALLENGE SECTION ===== */}
        {activeChallenge && (
          <View ref={challengeBarRef} collapsable={false}>
            <GlassCard style={s.challengeCard} padding={spacing.lg}>
              {/* AI trigger label */}
              {challengeTriggerInfo?.isAi && (
                <View style={s.aiTriggerRow}>
                  <BlinkAiAvatar size={18} />
                  <Text style={s.aiTriggerText}>Blink AI</Text>
                </View>
              )}
              {!challengeTriggerInfo?.isAi && challengeTriggerInfo && (
                <Text style={s.humanTriggerText}>
                  {challengeTriggerInfo.name} started this
                </Text>
              )}

              {/* Challenge prompt */}
              <Text style={s.challengePrompt}>
                {activeChallenge.prompt_text ?? activeChallenge.prompt ?? (
                  isQuizChallenge ? 'Quiz time!' : 'Snap Challenge!'
                )}
              </Text>

              {/* Timer row */}
              {countdown ? (
                <View style={s.timerRow}>
                  <Animated.View style={[s.timerDot, { opacity: pulseAnim }]} />
                  <Text style={s.timerText}>{countdown} remaining</Text>
                </View>
              ) : null}

              {/* Respond button OR ActivityPulse */}
              {!hasSubmittedToday ? (
                <TouchableOpacity
                  style={s.respondBtn}
                  onPress={handleSnapChallenge}
                  activeOpacity={0.85}
                  testID="snap-challenge-btn"
                >
                  {isQuizChallenge ? (
                    <Zap size={18} color={theme.white} />
                  ) : (
                    <Camera size={18} color={theme.white} />
                  )}
                  <Text style={s.respondBtnText}>Respond</Text>
                </TouchableOpacity>
              ) : (
                <View style={s.activityPulseInCard}>
                  {progressData && (
                    <ActivityPulse
                      respondedUsers={progressData.responded}
                      totalMembers={progressData.totalMembers}
                      currentUserId={user.id}
                      hasResponded={hasSubmittedToday}
                    />
                  )}
                  <View style={s.submittedInlineRow}>
                    <Text style={s.submittedInlineText}>You responded</Text>
                    {countdown ? (
                      <View style={s.countdownBadge}>
                        <Clock size={11} color={theme.green} />
                        <Text style={s.countdownBadgeText}>{countdown}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              )}
            </GlassCard>
          </View>
        )}

        {/* ===== 4. CHALLENGE RESPONSES ===== */}

        {/* Daily Spotlight */}
        {spotlight && !isDemo && (
          <SpotlightCard spotlight={spotlight} />
        )}

        {/* Blurred preview if user hasn't responded */}
        {!hasSubmittedToday && activeChallenge && !isDemo && (previewData || snaps.length > 0) && (
          <BlurredPreviewCard
            respondedCount={previewData?.respondedCount ?? snaps.length}
            totalMembers={previewData?.totalMembers ?? (group?.members.length ?? 0)}
            totalReactions={previewData?.totalReactions ?? 0}
            topReactionEmoji={previewData?.topReactionEmoji}
            respondedUsers={
              previewData?.respondedUsers ??
              snaps.map((sn) => ({ displayName: sn.userName, avatarUrl: sn.userAvatar }))
            }
            onRespond={handleSnapChallenge}
            activityPulseProps={
              progressData
                ? {
                    respondedUsers: progressData.responded,
                    totalMembers: progressData.totalMembers,
                    currentUserId: user.id,
                    hasResponded: false,
                  }
                : undefined
            }
          />
        )}

        {/* Loading / Error / Quiz Results / Snap Cards */}
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
            <View style={s.quizResultsContainer}>
              <GlassCard style={s.quizHeaderCard}>
                <Text style={[typography.headlineMedium, { color: theme.text }]}>
                  {activeChallenge.prompt_text ?? activeChallenge.prompt ?? 'Quiz'}
                </Text>
                <View style={s.quizResponseCount}>
                  <Users size={14} color={theme.textMuted} />
                  <Text style={s.quizResponseCountText}>
                    {(responsesQuery.data ?? []).length} {(responsesQuery.data ?? []).length === 1 ? 'response' : 'responses'}
                  </Text>
                </View>
              </GlassCard>
              {quizDistribution.map((item, i) => {
                const isTopAnswer = quizDistribution.every((d) => item.count >= d.count) && item.count > 0;
                const myResponse = (responsesQuery.data ?? []).find((r) => r.user_id === user.id);
                const isMyPick = myResponse?.answer_index === i;
                return (
                  <View key={i} style={s.quizResultRow}>
                    <View style={s.quizResultHeader}>
                      <View style={s.quizResultLabelRow}>
                        <Text style={[s.quizResultLabel, isTopAnswer && { color: theme.coral }]}>
                          {item.label}
                        </Text>
                        {isMyPick && (
                          <View style={s.quizMyPickBadge}>
                            <Text style={s.quizMyPickText}>You</Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.quizResultPercent}>{item.percentage}%</Text>
                    </View>
                    <View style={s.quizProgressBg}>
                      <View style={[
                        s.quizProgressFill,
                        { width: `${item.percentage}%`, backgroundColor: isTopAnswer ? theme.coral : theme.surfaceLight },
                      ]} />
                    </View>
                    {item.respondents.length > 0 && (
                      <View style={s.quizRespondentsRow}>
                        {item.respondents.slice(0, 5).map((r, ri) => (
                          <Image
                            key={ri}
                            source={{ uri: r.avatar }}
                            style={[s.quizRespondentAvatar, { marginLeft: ri > 0 ? -6 : 0, zIndex: 5 - ri }]}
                            contentFit="cover"
                          />
                        ))}
                        {item.respondents.length > 5 && (
                          <Text style={s.quizMoreRespondents}>+{item.respondents.length - 5}</Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : !hasSubmittedToday ? (
            <EmptyState
              emoji="\u{1F9E0}"
              title="Quiz active!"
              subtitle="Tap the challenge bar to answer"
            />
          ) : (
            <EmptyState
              emoji="\u23F3"
              title="Waiting for responses"
              subtitle="Results appear when others answer"
            />
          )
        ) : hasSubmittedToday && snaps.length > 0 ? (
          snaps.map(snap => (
            <SnapCard
              key={snap.id}
              snap={snap}
              isLocked={false}
              onReact={handleReaction}
              onReport={handleReportSnap}
              onBlock={handleBlockUser}
            />
          ))
        ) : snaps.length === 0 && !activeChallenge && groupPhotos.length === 0 ? (
          <EmptyState
            emoji="\u{1F4F8}"
            title="No snaps yet"
            subtitle="Start a challenge to see snaps here!"
          />
        ) : snaps.length > 0 && !hasSubmittedToday ? (
          // User hasn't submitted but there are snaps (locked view handled by BlurredPreviewCard above)
          null
        ) : null}

        {/* AI Commentary Card */}
        {aiCommentary && (
          <AiCommentaryCard commentary={aiCommentary.commentary} />
        )}

        {/* ===== 5. PHOTO TIMELINE ===== */}
        {!isDemo && (
          <PhotoTimeline
            photos={groupPhotos}
            groupId={id ?? ''}
            onSeeAll={() => router.push({ pathname: '/challenge-history' as never, params: { groupId: id } })}
          />
        )}

        {/* ===== 6. QUICK ACTIONS (BOTTOM) ===== */}
        <View style={s.bottomActions}>
          {/* Group Streak Banner */}
          {!isDemo && groupStreak > 0 && (
            <GroupStreakBanner
              groupStreak={groupStreak}
              longestGroupStreak={longestGroupStreak}
            />
          )}

          {/* Challenge Now button */}
          {!isDemo && !activeChallenge && (
            <TouchableOpacity
              style={s.challengeNowBtn}
              onPress={handleRing}
              activeOpacity={0.85}
            >
              <Zap size={20} color={theme.white} />
              <Text style={s.challengeNowText}>Challenge Now</Text>
            </TouchableOpacity>
          )}

          {/* Leaderboard link */}
          {!isDemo && leaderboard.length > 0 && (
            <TouchableOpacity
              style={s.leaderboardLink}
              onPress={() => router.push({ pathname: '/group-leaderboard' as never, params: { groupId: id } })}
              activeOpacity={0.7}
            >
              <Trophy size={16} color={theme.yellow} />
              <Text style={s.leaderboardLinkText}>View Leaderboard</Text>
              <ChevronRight size={14} color={theme.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 100 }} />
      </Animated.ScrollView>

      {/* Tour Tooltip: Step 2 -- Challenge bar */}
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

      {/* Ring Modal -- Challenge Type Picker */}
      <Modal visible={showRingModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={[typography.headlineLarge, { color: theme.text }]}>Start a Challenge</Text>
              <TouchableOpacity onPress={() => setShowRingModal(false)} style={s.modalClose}>
                <X size={20} color={theme.text} />
              </TouchableOpacity>
            </View>
            <View style={s.challengeGrid}>
              {challengeTypes.map((ct) => (
                <TouchableOpacity
                  key={ct.type}
                  style={s.challengeTypeBtn}
                  onPress={() => {
                    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    ringMutation.mutate(ct.type);
                  }}
                  disabled={ringMutation.isPending}
                  activeOpacity={0.8}
                >
                  <Text style={s.challengeTypeEmoji}>{ct.emoji}</Text>
                  <Text style={s.challengeTypeLabel}>{ct.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Group Menu Modal */}
      <Modal visible={showGroupMenu} transparent animationType="slide">
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowGroupMenu(false)}>
          <View style={s.modalContent} onStartShouldSetResponder={() => true}>
            <View style={s.modalHeader}>
              <Text style={[typography.headlineLarge, { color: theme.text }]}>{group.name}</Text>
              <TouchableOpacity onPress={() => setShowGroupMenu(false)} style={s.modalClose}>
                <X size={20} color={theme.text} />
              </TouchableOpacity>
            </View>

            <View style={s.menuList}>
              <TouchableOpacity
                style={s.menuItem}
                onPress={() => {
                  setShowGroupMenu(false);
                  router.push({ pathname: '/invite-members' as never, params: { groupId: id } });
                }}
              >
                <UserPlus size={20} color={theme.text} />
                <Text style={s.menuItemText}>Invite Members</Text>
              </TouchableOpacity>

              <TouchableOpacity style={s.menuItem} onPress={handleShareGroup}>
                <Share2 size={20} color={theme.text} />
                <Text style={s.menuItemText}>Share Group</Text>
              </TouchableOpacity>

              {isAdmin && (
                <TouchableOpacity style={s.menuItem} onPress={handleDeleteGroup}>
                  <Trash2 size={20} color={theme.red} />
                  <Text style={[s.menuItemText, { color: theme.red }]}>Delete Group</Text>
                </TouchableOpacity>
              )}

              {!isAdmin && (
                <TouchableOpacity style={s.menuItem} onPress={handleLeaveGroup}>
                  <LogOut size={20} color={theme.red} />
                  <Text style={[s.menuItemText, { color: theme.red }]}>Leave Group</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={s.menuItem}
                onPress={() => {
                  setShowGroupMenu(false);
                  setReportTarget({ contentType: 'group', reportedContentId: id });
                  setShowReportModal(true);
                }}
              >
                <Flag size={20} color={theme.yellow} />
                <Text style={[s.menuItemText, { color: theme.yellow }]}>Report Group</Text>
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

      {/* Streak Celebration Overlay */}
      <StreakCelebration
        visible={!!streakCelebration}
        userName={streakCelebration?.userName ?? ''}
        streakDays={streakCelebration?.streakDays ?? 0}
        onDismiss={() => setStreakCelebration(null)}
      />
    </View>
  );
}

// ===========================
// STYLES
// ===========================
const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },

  // ---- Header ----
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
  headerEmoji: {
    fontSize: 24,
  },
  headerTitle: {
    ...typography.headlineLarge,
    color: theme.text,
    maxWidth: 180,
  },
  headerRight: {
    width: 38,
    alignItems: 'flex-end',
  },
  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ---- ScrollView ----
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },

  // ---- Member Ring Row ----
  memberRingSection: {
    marginBottom: spacing.lg,
  },
  memberRingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  memberRingItem: {
    alignItems: 'center',
  },
  memberTooltip: {
    position: 'absolute',
    bottom: -20,
    backgroundColor: theme.bgCardSolid,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.border,
  },
  memberTooltipText: {
    ...typography.bodySmall,
    color: theme.text,
    fontWeight: '600',
  },
  respondedCount: {
    ...typography.bodySmall,
    color: theme.textMuted,
    marginTop: spacing.sm,
  },

  // ---- AI Personality ----
  personalityRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },

  // ---- Active Challenge Card ----
  challengeCard: {
    marginBottom: spacing.lg,
  },
  aiTriggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  aiTriggerText: {
    ...typography.labelSmall,
    color: theme.purple,
  },
  humanTriggerText: {
    ...typography.bodySmall,
    color: theme.textMuted,
    marginBottom: spacing.sm,
  },
  challengePrompt: {
    ...typography.headlineMedium,
    color: theme.text,
    marginBottom: spacing.md,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  timerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.coral,
  },
  timerText: {
    ...typography.bodySmall,
    color: theme.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  respondBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: theme.coral,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  respondBtnText: {
    ...typography.labelLarge,
    color: theme.white,
  },
  activityPulseInCard: {
    gap: spacing.sm,
  },
  submittedInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  submittedInlineText: {
    ...typography.bodySmall,
    color: theme.green,
    fontWeight: '600',
  },
  countdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.15)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  countdownBadgeText: {
    ...typography.bodySmall,
    color: theme.green,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },

  // ---- Quiz Results ----
  quizResultsContainer: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  quizHeaderCard: {
    marginBottom: spacing.xs,
  },
  quizResponseCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quizResponseCountText: {
    ...typography.bodySmall,
    color: theme.textMuted,
    fontWeight: '600',
  },
  quizResultRow: {
    backgroundColor: theme.bgCard,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
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
    gap: spacing.sm,
  },
  quizResultLabel: {
    ...typography.bodyLarge,
    fontWeight: '700',
    color: theme.text,
  },
  quizResultPercent: {
    ...typography.headlineMedium,
    color: theme.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  quizMyPickBadge: {
    backgroundColor: theme.blueMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  quizMyPickText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.blue,
  },
  quizProgressBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  quizProgressFill: {
    height: '100%',
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
    ...typography.bodySmall,
    color: theme.textMuted,
    marginLeft: 6,
  },

  // ---- Past Challenges Grid ----
  pastSection: {
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  pastHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    ...typography.bodySmall,
    color: theme.textMuted,
    fontWeight: '600',
  },
  thumbGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: THUMB_GAP,
  },
  thumbItem: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: theme.surface,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.surfaceLight,
  },
  thumbPlaceholderEmoji: {
    fontSize: 28,
  },
  thumbOverlay: {
    position: 'absolute',
    bottom: spacing.xs,
    right: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbEmojiOverlay: {
    fontSize: 12,
  },
  thumbOverlayBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderBottomLeftRadius: borderRadius.md,
    borderBottomRightRadius: borderRadius.md,
  },
  thumbAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginRight: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  thumbTime: {
    color: '#fff',
    fontSize: 10,
    flex: 1,
  },

  // ---- Bottom Actions ----
  bottomActions: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  challengeNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: theme.coral,
    paddingVertical: 14,
    borderRadius: borderRadius.lg,
  },
  challengeNowText: {
    ...typography.labelLarge,
    color: theme.white,
    fontWeight: '800',
  },
  leaderboardLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  leaderboardLinkText: {
    ...typography.bodyMedium,
    color: theme.textMuted,
    fontWeight: '600',
  },

  // ---- Modals ----
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.bgCardSolid,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    padding: spacing.xxl,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xl,
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
    gap: spacing.md,
  },
  challengeTypeBtn: {
    width: '47%',
    backgroundColor: theme.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  challengeTypeEmoji: {
    fontSize: 32,
  },
  challengeTypeLabel: {
    ...typography.labelLarge,
    color: theme.text,
  },

  // ---- Group Menu ----
  menuList: {
    gap: spacing.xs,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: spacing.xs,
  },
  menuItemText: {
    ...typography.bodyLarge,
    fontWeight: '600',
    color: theme.text,
  },
});
