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
import { fetchFeed, shouldBlurOthers } from '@/services/challengeReads';
import type { ApiChallengeDetail } from '@/types/api';
import AvatarRing from '@/components/ui/AvatarRing';
import { FeedItemData } from '@/components/FeedItem';
import ChallengeCard from '@/components/ChallengeCard';
import DemoChallengeAlert from '@/components/DemoChallengeAlert';
import { useOnboardingStore } from '@/stores/onboardingStore';

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

  // ── Feed: challenges across the user's groups (GET /feed) ──
  // The atomic unit is a CHALLENGE, not a photo. Open challenges you haven't
  // answered become cards with an "Add yours" CTA; answered or closed ones
  // become cards with their photo responses as thumbnails (each shows a
  // placeholder until its photo arrives over the relay). Socket events
  // refresh it — including expiry, which the server announces — so it
  // doesn't poll. The demo group has its own alert and never hits the API.
  const feedQuery = useQuery({
    queryKey: ['blinks-feed-v2'],
    queryFn: () => fetchFeed(),
    enabled: serverGroups.length > 0,
    staleTime: 15_000,
  });

  const feedData = useMemo<FeedItemData[]>(() => {
    const items = feedQuery.data?.items ?? [];
    const card = (c: ApiChallengeDetail, isLive: boolean): FeedItemData => ({
      id: isLive ? `cc_live_${c.id}` : `cc_${c.id}`,
      type: 'challenge_card',
      groupId: c.group_id,
      groupName: c.group_name,
      groupEmoji: c.group_emoji,
      challengeId: c.id,
      challengePrompt: c.prompt || undefined,
      isLive,
      expiresAt: isLive ? c.expires_at : undefined,
      responseCount: c.response_count,
      memberCount: c.member_count,
      challengeResponses: isLive
        ? undefined
        : c.responses.filter((r) => r.has_photo).map((r) => ({ responseId: r.id, userName: r.display_name || 'User' })),
      timestamp: c.created_at,
    });
    const newestActivity = (c: ApiChallengeDetail) =>
      Math.max(new Date(c.created_at).getTime(), ...c.responses.map((r) => new Date(r.responded_at).getTime()));

    // Live challenges first, soonest-to-expire first.
    const live = items
      .filter((c) => shouldBlurOthers(c))
      .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())
      .map((c) => card(c, true));
    // Then the ones you answered, and closed ones anyone answered, newest activity first.
    const rest = items
      .filter((c) => !shouldBlurOthers(c) && (c.user_has_responded || c.response_count > 0))
      .sort((a, b) => newestActivity(b) - newestActivity(a))
      .map((c) => card(c, false));
    return [...live, ...rest];
  }, [feedQuery.data]);

  // Live updates (started / response / finalized) invalidate this screen's
  // queries in services/socketEvents.

  // ── Handlers ──

  const handleNotifications = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push('/notifications');
  }, [router]);

  const handleFeedItemPress = useCallback(
    (item: FeedItemData) => {
      if (item.groupId) {
        router.push({
          pathname: '/group-detail',
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
        pathname: '/snap-challenge',
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
    await Promise.all([refreshGroups(), queryClient.invalidateQueries({ queryKey: ['blinks-feed-v2'] })]);
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
    !isLoading && (hasNoGroups || (groups.length > 0 && feedQuery.isFetched && feedData.length === 0));

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
            router.push('/(tabs)/(groups)');
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
              router.push('/(tabs)/profile');
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
