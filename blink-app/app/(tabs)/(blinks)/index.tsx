import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Platform,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useScrollToTop } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Zap } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import { useApp } from '@/providers/AppProvider';
import { api } from '@/services/api';
import { getSocket } from '@/services/socket';
import { Group } from '@/types';
import { ApiChallenge, ApiChallengeResponse } from '@/types/api';
import AvatarRing from '@/components/ui/AvatarRing';
import { FeedItemData } from '@/components/FeedItem';
import ChallengeCard from '@/components/ChallengeCard';
import DemoChallengeAlert from '@/components/DemoChallengeAlert';
import { useOnboardingStore } from '@/stores/onboardingStore';

// ── Types ──

interface ChallengeHistoryItem {
  id: string;
  group_id: string;
  prompt: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  status: string;
  response_count: number;
  member_count: number;
  user_responded: boolean;
}

interface PendingChallenge {
  group: Group;
  challenge: ApiChallenge;
  responses?: ApiChallengeResponse[];
}

/** A challenge the user answered, with the photo responses to thumbnail on its card. */
interface AnsweredChallenge {
  group: Group;
  challenge: ChallengeHistoryItem;
  photoResponses: { responseId: string; userName?: string; timestamp: string }[];
  /** Responses fetch failed: show the card with the history row's count and no thumbnails. */
  responsesUnavailable: boolean;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Feed Skeleton ──

function FeedSkeleton() {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 0.7, 0.3],
  });

  return (
    <View style={styles.skeletonContainer}>
      {[0, 1, 2].map((i) => (
        <Animated.View key={i} style={[styles.skeletonCard, { opacity }]}>
          {/* Header skeleton */}
          <View style={styles.skeletonHeader}>
            <View style={styles.skeletonCircle} />
            <View style={styles.skeletonLines}>
              <View style={[styles.skeletonLine, { width: 180 }]} />
            </View>
          </View>
          {/* Photo skeleton */}
          <View style={styles.skeletonPhoto} />
          {/* Reactions skeleton */}
          <View style={styles.skeletonReactions}>
            <View style={[styles.skeletonLine, { width: 50, height: 24, borderRadius: 12 }]} />
            <View style={[styles.skeletonLine, { width: 50, height: 24, borderRadius: 12 }]} />
            <View style={[styles.skeletonLine, { width: 50, height: 24, borderRadius: 12 }]} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

// ── Main Screen ──

export default function BlinksScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    groups,
    serverGroups,
    user,
    shouldShowDemoGroup,
    unreadNotificationCount,
    refreshGroups,
    isRefreshing,
    isLoading: isGroupsLoading,
    addReaction,
  } = useApp();

  const demoChallengeCompleted = useOnboardingStore((s) => s.demoChallengeCompleted);
  const [demoDismissed, setDemoDismissed] = useState(false);
  const showDemoAlert = shouldShowDemoGroup && !demoChallengeCompleted && !demoDismissed;

  const flatListRef = useRef<FlatList>(null);
  useScrollToTop(flatListRef);

  // Feed queries only call the API for server groups (the demo group has its own alert).
  const serverGroupKey = [...serverGroups.map((g) => g.id)].sort().join(',');

  // ── Fetch active challenges across all groups ──
  const activeChallengesQuery = useQuery({
    queryKey: ['feed-active-challenges', serverGroupKey],
    queryFn: async (): Promise<PendingChallenge[]> => {
      const results: PendingChallenge[] = [];
      const groupsWithChallenge = serverGroups.filter((g) => g.hasActiveChallenge);
      const fetches = groupsWithChallenge.map(async (group) => {
        try {
          const challenge: ApiChallenge = await api(`/challenges/groups/${group.id}/challenges/active`);
          if (
            challenge &&
            !challenge.user_has_responded &&
            challenge.expires_at &&
            new Date(challenge.expires_at).getTime() > Date.now()
          ) {
            // Only show active challenges that haven't expired yet
            let responses: ApiChallengeResponse[] = [];
            try {
              responses = await api(`/challenges/${challenge.id}/responses`);
              if (!Array.isArray(responses)) responses = [];
            } catch {
              // Non-critical: responses may not be available yet
            }
            results.push({ group, challenge, responses });
          }
        } catch {
          // Non-critical: challenge may have expired between list fetch and detail fetch
        }
      });
      await Promise.all(fetches);
      return results;
    },
    enabled: groups.length > 0,
    staleTime: 15_000,
    // Refetch every 30s so expired challenges vanish automatically
    refetchInterval: 30_000,
  });

  const pendingChallenges = activeChallengesQuery.data ?? [];

  // ── Answered challenges: history + the photo responses for each ──
  const feedQuery = useQuery({
    queryKey: ['blinks-feed-v2', serverGroupKey],
    queryFn: async (): Promise<AnsweredChallenge[]> => {
      const answered: AnsweredChallenge[] = [];

      // Fetch history + responses for each group in parallel
      const fetches = serverGroups.map(async (group) => {
        try {
          const history: ChallengeHistoryItem[] = await api(
            `/challenges/groups/${group.id}/challenges/history?limit=5`,
          );
          if (!Array.isArray(history)) return;

          // Unanswered challenges only show in the group mini-feed, not here.
          const challengeFetches = history
            .filter((challenge) => challenge.user_responded)
            .map(async (challenge) => {
              try {
                const responses: ApiChallengeResponse[] = await api(`/challenges/${challenge.id}/responses`);
                if (!Array.isArray(responses)) return;
                const photoResponses = responses
                  .filter((resp) => resp.has_photo)
                  .map((resp) => ({
                    responseId: resp.id,
                    userName: resp.display_name || 'User',
                    timestamp: resp.responded_at || resp.created_at,
                  }));
                if (photoResponses.length > 0) {
                  answered.push({ group, challenge, photoResponses, responsesUnavailable: false });
                }
              } catch {
                // Responses endpoint failed -- still show the card, without thumbnails
                answered.push({ group, challenge, photoResponses: [], responsesUnavailable: true });
              }
            });

          await Promise.all(challengeFetches);
        } catch {
          // Non-critical: group may not have challenge history yet
        }
      });

      await Promise.all(fetches);
      return answered;
    },
    enabled: groups.length > 0,
    staleTime: 30_000,
  });

  // ── Challenge-grouped feed ──
  // The atomic unit is a CHALLENGE, not a photo. Live (unanswered) challenges
  // become cards with an "Add yours" CTA; answered/closed challenges become a
  // card with their response photos as thumbnails.
  const feedData = useMemo<FeedItemData[]>(() => {
    const out: FeedItemData[] = [];

    // Live challenges first — one card each, sorted soonest-to-expire.
    const liveSorted = [...pendingChallenges].sort((a, b) => {
      const ea = a.challenge.expires_at ? new Date(a.challenge.expires_at).getTime() : Infinity;
      const eb = b.challenge.expires_at ? new Date(b.challenge.expires_at).getTime() : Infinity;
      return ea - eb;
    });
    for (const pc of liveSorted) {
      out.push({
        id: `cc_live_${pc.challenge.id}`,
        type: 'challenge_card',
        groupId: pc.group.id,
        groupName: pc.group.name,
        groupEmoji: pc.group.emoji,
        challengeId: pc.challenge.id,
        challengePrompt: pc.challenge.prompt || undefined,
        isLive: true,
        expiresAt: pc.challenge.expires_at,
        responseCount: pc.responses?.length ?? 0,
        memberCount: pc.group.memberCount ?? pc.group.members?.length ?? 0,
        timestamp: pc.challenge.created_at || new Date().toISOString(),
      });
    }

    // Answered/closed challenges, newest activity first.
    const newest = (a: AnsweredChallenge) =>
      Math.max(
        ...a.photoResponses.map((p) => new Date(p.timestamp).getTime()),
        a.responsesUnavailable ? new Date(a.challenge.created_at).getTime() : 0,
        0,
      );
    const answered = [...(feedQuery.data ?? [])].sort((a, b) => newest(b) - newest(a));
    for (const a of answered) {
      out.push({
        id: `cc_${a.challenge.id}`,
        type: 'challenge_card',
        groupId: a.group.id,
        groupName: a.group.name,
        groupEmoji: a.group.emoji,
        challengeId: a.challenge.id,
        challengePrompt: a.challenge.prompt || undefined,
        isLive: false,
        responseCount: a.responsesUnavailable ? Number(a.challenge.response_count) || 0 : a.photoResponses.length,
        challengeResponses: a.photoResponses.length > 0 ? a.photoResponses : undefined,
        timestamp: a.challenge.created_at,
      });
    }

    return out;
  }, [pendingChallenges, feedQuery.data]);

  // ── Socket listeners ──
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ['feed-active-challenges'] });
      queryClient.invalidateQueries({ queryKey: ['blinks-feed-v2'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    };

    socket.on('challenge:started', handleUpdate);
    socket.on('challenge:completed', handleUpdate);
    socket.on('challenge:response', handleUpdate);

    return () => {
      socket.off('challenge:started', handleUpdate);
      socket.off('challenge:completed', handleUpdate);
      socket.off('challenge:response', handleUpdate);
    };
  }, [queryClient]);

  // ── Handlers ──

  const handleNotifications = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push('/notifications' as never);
  }, [router]);

  const handleFeedItemPress = useCallback(
    (item: FeedItemData) => {
      if (item.groupId) {
        router.push({
          pathname: '/group-detail' as never,
          params: { id: item.groupId },
        });
      }
    },
    [router],
  );

  const handleFeedItemRespond = useCallback(
    (item: FeedItemData) => {
      if (!item.groupId) return;
      const group = groups.find((g) => g.id === item.groupId);
      if (!group) return;

      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      router.push({
        pathname: '/snap-challenge' as never,
        params: { groupId: group.id },
      });
    },
    [groups, router],
  );

  const handleReact = useCallback(
    (item: FeedItemData, emoji: string) => {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      // The item id format is `photo_${responseId}`
      const responseId = item.id.replace('photo_', '');
      addReaction(responseId, emoji);
    },
    [addReaction],
  );

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      refreshGroups(),
      queryClient.invalidateQueries({ queryKey: ['blinks-feed-v2'] }),
      queryClient.invalidateQueries({ queryKey: ['feed-active-challenges'] }),
    ]);
  }, [refreshGroups, queryClient]);

  // ── Wire callbacks into each item ──
  const wire = useCallback(
    (items: FeedItemData[]) =>
      items.map((item) => ({
        ...item,
        onPress: () => handleFeedItemPress(item),
        onRespond: () => handleFeedItemRespond(item),
        onReact: (emoji: string) => handleReact(item, emoji),
      })),
    [handleFeedItemPress, handleFeedItemRespond, handleReact],
  );
  const wiredFeedData = useMemo(() => wire(feedData), [wire, feedData]);

  // ── Render ──

  const renderItem = useCallback(({ item }: { item: FeedItemData }) => <ChallengeCard item={item} />, []);

  const keyExtractor = useCallback((item: FeedItemData) => item.id, []);

  const isLoading = isGroupsLoading || (groups.length > 0 && feedQuery.isLoading);
  // "User has no feed content" — true when not loading AND either no groups
  // or groups with no answered challenges yet.
  const hasNoGroups = !isGroupsLoading && groups.length === 0;
  const hasNoUserContent =
    !isLoading && (hasNoGroups || (groups.length > 0 && feedQuery.isFetched && (feedQuery.data ?? []).length === 0));

  // ── List Header: the no-content / no-groups CTA ──
  const ListHeader = useMemo(() => {
    if (!hasNoUserContent) return null;
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconContainer}>
          <Zap size={48} color={theme.coral} fill={theme.coral} />
        </View>
        <Text style={styles.emptyTitle}>{hasNoGroups ? 'Welcome to Blink' : 'No challenges yet'}</Text>
        <Text style={styles.emptySubtitle}>
          {hasNoGroups
            ? 'Capture moments with your closest crew via daily snap challenges. Join a group to start.'
            : 'When your groups run challenges, they show up here.'}
        </Text>
        <TouchableOpacity
          style={styles.emptyAction}
          onPress={() => {
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            router.push('/(tabs)/(groups)' as never);
          }}
        >
          <LinearGradient
            colors={[theme.coral, theme.coralDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.emptyActionGradient}
          >
            <Text style={styles.emptyActionText}>{hasNoGroups ? 'Create or Join a Group' : 'Go to Groups'}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }, [hasNoUserContent, hasNoGroups, router]);

  // ── List Empty (first-load skeleton) ──
  const ListEmpty = useMemo(() => (isLoading ? <FeedSkeleton /> : null), [isLoading]);

  // ── List Footer ──
  // Trailing spacer so the last card isn't flush with the tab bar.
  const ListFooter = useMemo(() => <View style={{ height: 100 }} />, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Demo challenge alert overlay */}
      <DemoChallengeAlert visible={showDemoAlert} onDismiss={() => setDemoDismissed(true)} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Home</Text>
          <Zap size={20} color={theme.coral} fill={theme.coral} />
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.notifBtn} onPress={handleNotifications} testID="notifications-btn">
            <Bell size={20} color={theme.text} />
            {unreadNotificationCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              router.push('/(tabs)/profile' as never);
            }}
          >
            <AvatarRing name={user.name} size={34} ringColor={theme.coral} showStatus hasResponded />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={wiredFeedData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.feedContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={theme.coral} />}
        removeClippedSubviews={Platform.OS !== 'web'}
        maxToRenderPerBatch={5}
        windowSize={7}
        initialNumToRender={4}
      />
    </View>
  );
}

// ── Styles ──

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    ...typography.displayMedium,
    color: theme.text,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  notifBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: theme.bg,
  },
  notifBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: theme.white,
  },

  // Feed
  feedContent: {
    paddingTop: spacing.sm,
    flexGrow: 1,
  },

  // Skeleton
  skeletonContainer: {
    gap: spacing.xxl,
    paddingTop: spacing.lg,
  },
  skeletonCard: {
    gap: spacing.md,
  },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  skeletonCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.surface,
  },
  skeletonLines: {
    gap: spacing.xs,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.surface,
  },
  skeletonPhoto: {
    width: SCREEN_WIDTH,
    aspectRatio: 5 / 4,
    backgroundColor: theme.bgCardSolid,
  },
  skeletonReactions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: spacing.xl,
  },
  emptyIconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  emptyTitle: {
    ...typography.headlineLarge,
    color: theme.text,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    ...typography.bodyMedium,
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xxl,
    maxWidth: 280,
  },
  emptyAction: {
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  emptyActionGradient: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
  },
  emptyActionText: {
    ...typography.labelLarge,
    color: theme.white,
    fontWeight: '700',
  },

  // Footer
  footerContainer: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  footerText: {
    ...typography.bodySmall,
    color: theme.textMuted,
  },
});
