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
import { getRelativeTime } from '@/utils/time';
import { Group } from '@/types';
import { ApiChallenge, ApiChallengeResponse, ApiSpotlight } from '@/types/api';
import AvatarRing from '@/components/ui/AvatarRing';
import FeedItem, { FeedItemData } from '@/components/FeedItem';
import ChallengeCard from '@/components/ChallengeCard';
import LaneTabs, { Lane } from '@/components/LaneTabs';
import DemoChallengeAlert from '@/components/DemoChallengeAlert';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { isDemoGroup } from '@/constants/demoData';
import { WORLDWIDE_CHALLENGES } from '@/constants/worldwideExamples';

// ── Types ──

interface ChallengeHistoryItem {
  id: string;
  group_id: string;
  type: string;
  prompt: string | null;
  options: string[] | null;
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

// ── Animated Feed Item Wrapper ──

const AnimatedFeedItem = React.memo(function AnimatedFeedItem({
  item,
}: {
  item: FeedItemData;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <FeedItem item={item} />
    </Animated.View>
  );
});

// ── Lane empty state (e.g. For You placeholder) ──

function LaneEmpty({ item }: { item: FeedItemData }) {
  return (
    <View style={styles.laneEmpty}>
      <Text style={styles.emptyTitle}>{item.emptyTitle}</Text>
      <Text style={styles.emptySubtitle}>{item.emptySubtitle}</Text>
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

  // Which Home lane is showing: 🔒 Groups (private), 🌍 World, ✨ For You.
  const [activeLane, setActiveLane] = useState<Lane>('groups');

  const flatListRef = useRef<FlatList>(null);
  useScrollToTop(flatListRef);

  // ── Fetch active challenges across all groups ──
  const activeChallengesQuery = useQuery({
    queryKey: ['feed-active-challenges', [...groups.map((g) => g.id)].sort().join(',')],
    queryFn: async (): Promise<PendingChallenge[]> => {
      const results: PendingChallenge[] = [];
      const groupsWithChallenge = groups.filter((g) => g.hasActiveChallenge && !isDemoGroup(g.id));
      const fetches = groupsWithChallenge.map(async (group) => {
        try {
          const challenge: ApiChallenge = await api(
            `/challenges/groups/${group.id}/challenges/active`,
          );
          if (challenge && !challenge.user_has_responded && challenge.expires_at && new Date(challenge.expires_at).getTime() > Date.now()) {
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

  // ── Build the feed from challenge history + individual responses ──
  const feedQuery = useQuery({
    queryKey: ['blinks-feed-v2', [...groups.map((g) => g.id)].sort().join(',')],
    queryFn: async (): Promise<FeedItemData[]> => {
      if (groups.length === 0) return [];

      const allItems: FeedItemData[] = [];

      // Fetch history + responses for each group in parallel (skip demo groups)
      const realGroups = groups.filter((g) => !isDemoGroup(g.id));
      const fetches = realGroups.map(async (group) => {
        try {
          const history: ChallengeHistoryItem[] = await api(
            `/challenges/groups/${group.id}/challenges/history?limit=5`,
          );
          if (!Array.isArray(history)) return;

          // For each challenge, try to get individual responses
          const challengeFetches = history.map(async (challenge) => {
            if (challenge.user_responded) {
              // User responded -- try to get individual responses (photos)
              try {
                const responses: ApiChallengeResponse[] = await api(
                  `/challenges/${challenge.id}/responses`,
                );
                if (Array.isArray(responses) && responses.length > 0) {
                  // Create a feed item for each individual response
                  for (const resp of responses) {
                    if (challenge.type === 'snap' && resp.photo_url) {
                      allItems.push({
                        id: `photo_${resp.id}`,
                        type: 'photo',
                        userName: resp.display_name || 'User',
                        userAvatar: resp.avatar_url || undefined,
                        groupName: group.name,
                        groupEmoji: group.emoji,
                        groupId: group.id,
                        challengeId: challenge.id,
                        photoUrl: resp.photo_url,
                        challengePrompt: challenge.prompt || undefined,
                        timeAgo: getRelativeTime(resp.responded_at || resp.created_at),
                        timestamp: resp.responded_at || resp.created_at,
                        reactions: [], // Will be enriched separately if needed
                      });
                    } else if (
                      challenge.type !== 'snap' &&
                      (resp.answer_text || resp.answer_index !== null)
                    ) {
                      // Quiz responses are aggregated per challenge, not per response
                      // We handle them below
                    }
                  }

                  // For quiz-type challenges, create one quiz result item
                  if (challenge.type !== 'snap') {
                    const quizResults = buildQuizResults(responses, challenge);
                    if (quizResults.length > 0) {
                      allItems.push({
                        id: `quiz_${challenge.id}`,
                        type: 'quiz_result',
                        groupName: group.name,
                        groupEmoji: group.emoji,
                        groupId: group.id,
                        challengeId: challenge.id,
                        quizQuestion: challenge.prompt || 'Quiz',
                        quizResults,
                        timeAgo: getRelativeTime(challenge.created_at),
                        timestamp: challenge.created_at,
                      });
                    }
                  }
                }
              } catch {
                // Responses endpoint failed -- create a summary card
                createFallbackItem(allItems, challenge, group);
              }
            } else {
              // User has NOT responded -- skip from main feed
              // Unresponded challenges only show in the group mini-feed
            }
          });

          await Promise.all(challengeFetches);
        } catch {
          // Non-critical: group may not have challenge history yet
        }
      });

      // Fetch spotlights for each group (skip demo groups)
      const spotlightFetches = realGroups.map(async (group) => {
        try {
          const spotlight: ApiSpotlight = await api(`/spotlight/${group.id}`);
          if (spotlight && spotlight.featured_user_id) {
            allItems.push({
              id: `spotlight_${spotlight.id}`,
              type: 'spotlight',
              groupName: group.name,
              groupEmoji: group.emoji,
              groupId: group.id,
              spotlightUser: spotlight.display_name || 'Someone',
              superlative: spotlight.superlative,
              funFact: spotlight.stats_json?.fun_fact,
              timeAgo: getRelativeTime(spotlight.date),
              timestamp: spotlight.date,
            });
          }
        } catch {
          // Non-critical: spotlight endpoint may not exist or group has no spotlight
        }
      });

      await Promise.all([...fetches, ...spotlightFetches]);

      // Sort by timeAgo relevance (most recent first)
      // We parse timeAgo back or sort by creation. Since timeAgo is already computed,
      // we use the original timestamps embedded in the IDs or just keep insertion order.
      // For a proper sort, we track timestamps separately.
      return allItems;
    },
    enabled: groups.length > 0,
    staleTime: 30_000,
  });

  // ── 🔒 GROUPS lane: challenge-grouped feed ──
  // The atomic unit is a CHALLENGE, not a photo. Live (unanswered) challenges
  // become cards with an "Add yours" CTA; answered/closed challenges become a
  // card header with their response photos rendered underneath.
  const groupsLaneData = useMemo<FeedItemData[]>(() => {
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
        challengePrompt: pc.challenge.prompt_text || pc.challenge.prompt || undefined,
        challengeType: pc.challenge.type,
        isLive: true,
        expiresAt: pc.challenge.expires_at,
        responseCount: pc.responses?.length ?? 0,
        memberCount: pc.group.memberCount ?? pc.group.members?.length ?? 0,
        timestamp: pc.challenge.triggered_at || new Date().toISOString(),
      });
    }

    // Answered/closed challenges from the feed, grouped by challengeId.
    const items = feedQuery.data ?? [];
    const byChallenge = new Map<string, FeedItemData[]>();
    const orderKeys: string[] = [];
    for (const it of items) {
      if (!it.challengeId) continue; // spotlight / ai commentary — omit from Groups
      if (!byChallenge.has(it.challengeId)) {
        byChallenge.set(it.challengeId, []);
        orderKeys.push(it.challengeId);
      }
      byChallenge.get(it.challengeId)!.push(it);
    }
    const newest = (arr: FeedItemData[]) =>
      Math.max(...arr.map((a) => (a.timestamp ? new Date(a.timestamp).getTime() : 0)), 0);
    orderKeys.sort((a, b) => newest(byChallenge.get(b)!) - newest(byChallenge.get(a)!));

    for (const cid of orderKeys) {
      const grp = byChallenge.get(cid)!;
      const first = grp[0];
      const photoItems = grp.filter((g) => g.type === 'photo');
      const quizItems = grp.filter((g) => g.type === 'quiz_result');
      // Snap responses become inline thumbnails inside the card; quiz results
      // still render as their own card beneath (different visualization).
      const challengeResponses = photoItems.map((p) => ({
        responseId: p.id.startsWith('photo_') ? p.id.slice('photo_'.length) : p.id,
        userName: p.userName,
        photoUrl: p.photoUrl,
      }));
      out.push({
        id: `cc_${cid}`,
        type: 'challenge_card',
        groupId: first.groupId,
        groupName: first.groupName,
        groupEmoji: first.groupEmoji,
        challengeId: cid,
        challengePrompt: first.challengePrompt || first.quizQuestion,
        challengeType: first.challengeType || (first.type === 'quiz_result' ? 'quiz' : 'snap'),
        isLive: false,
        responseCount: photoItems.length || grp.length,
        challengeResponses: challengeResponses.length > 0 ? challengeResponses : undefined,
        timestamp: first.timestamp,
      });
      // Keep quiz result bars beneath the card header.
      out.push(...quizItems);
    }

    return out;
  }, [pendingChallenges, feedQuery.data]);

  // ── 🌍 WORLD lane: global challenges (seeded until "Share to world" ships) ──
  const worldLaneData = useMemo<FeedItemData[]>(
    () =>
      WORLDWIDE_CHALLENGES.map((ch) => ({
        id: `ww_challenge_${ch.promptId}`,
        type: 'worldwide_challenge' as const,
        worldwideChallenge: ch,
      })),
    [],
  );

  // ── ✨ FOR YOU lane: personalized public discovery (Phase 3) ──
  const forYouLaneData = useMemo<FeedItemData[]>(
    () => [
      {
        id: 'foryou_empty',
        type: 'lane_empty',
        emptyTitle: '✨ For You is coming soon',
        emptySubtitle:
          'Once the World fills up with public challenges, this lane will surface the ones you’ll love — picked just for you.',
      },
    ],
    [],
  );

  const laneRawData = useMemo<FeedItemData[]>(() => {
    if (activeLane === 'world') return worldLaneData;
    if (activeLane === 'foryou') return forYouLaneData;
    return groupsLaneData;
  }, [activeLane, groupsLaneData, worldLaneData, forYouLaneData]);

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

  const navigateToChallenge = useCallback(
    (group: Group, challenge?: ApiChallenge | null) => {
      if (
        challenge &&
        (challenge.type === 'quiz' ||
          challenge.type === 'quiz_food' ||
          challenge.type === 'quiz_most_likely' ||
          challenge.type === 'quiz_rate_day' ||
          challenge.type === 'prompt')
      ) {
        router.push({
          pathname: '/quiz-challenge' as never,
          params: {
            groupId: group.id,
            challengeId: challenge.id,
            type: challenge.type,
            promptText: challenge.prompt_text ?? challenge.prompt ?? '',
            optionsJson: JSON.stringify(
              challenge.options_json ?? challenge.options ?? [],
            ),
            expiresAt: challenge.expires_at,
          },
        });
      } else {
        router.push({
          pathname: '/snap-challenge' as never,
          params: { groupId: group.id },
        });
      }
    },
    [router],
  );

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

      // Find matching pending challenge
      const pending = pendingChallenges.find(
        (pc) => pc.group.id === item.groupId,
      );
      if (pending) {
        navigateToChallenge(pending.group, pending.challenge);
      } else {
        // Navigate to snap challenge as fallback
        router.push({
          pathname: '/snap-challenge' as never,
          params: { groupId: item.groupId },
        });
      }
    },
    [groups, pendingChallenges, navigateToChallenge, router],
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

  // ── Wire up callbacks into the active lane's items ──
  const laneData = useMemo(() => {
    return laneRawData.map((item) => ({
      ...item,
      onPress: () => handleFeedItemPress(item),
      onRespond: () => handleFeedItemRespond(item),
      onReact: (emoji: string) => handleReact(item, emoji),
    }));
  }, [laneRawData, handleFeedItemPress, handleFeedItemRespond, handleReact]);

  // ── Render ──

  const renderItem = useCallback(
    ({ item }: { item: FeedItemData }) => {
      if (item.type === 'challenge_card') {
        return (
          <Animated.View>
            <ChallengeCard item={item} />
          </Animated.View>
        );
      }
      if (item.type === 'lane_empty') {
        return <LaneEmpty item={item} />;
      }
      return <AnimatedFeedItem item={item} />;
    },
    [],
  );

  const keyExtractor = useCallback((item: FeedItemData) => item.id, []);

  const isLoading =
    isGroupsLoading || (groups.length > 0 && feedQuery.isLoading);
  // "User has no real feed content of their own" — true when not loading AND
  // either no groups or groups with no activity yet. Worldwide items don't
  // count toward "real content" so they aren't checked here.
  const hasNoGroups = !isGroupsLoading && groups.length === 0;
  const hasNoUserContent =
    !isLoading &&
    (hasNoGroups || (groups.length > 0 && feedQuery.isFetched && (feedQuery.data ?? []).length === 0));

  // ── List Header ──
  // Groups lane only: the no-content / no-groups CTA. Other lanes carry their
  // own content (World cards, For You placeholder).
  const ListHeader = useMemo(() => {
    if (activeLane !== 'groups' || !hasNoUserContent) return null;
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconContainer}>
          <Zap size={48} color={theme.coral} fill={theme.coral} />
        </View>
        <Text style={styles.emptyTitle}>
          {hasNoGroups ? 'Welcome to Blink' : 'No challenges yet'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {hasNoGroups
            ? 'Capture moments with your closest crew via daily snap challenges. Join a group to start, or swipe to World to see what people are sharing.'
            : 'When your groups run challenges, they show up here. Swipe to World to see what people are sharing around the globe.'}
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
            <Text style={styles.emptyActionText}>
              {hasNoGroups ? 'Create or Join a Group' : 'Go to Groups'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }, [activeLane, hasNoUserContent, hasNoGroups, router]);

  // ── List Empty ──
  // Only the Groups lane has an async first load; other lanes are always ready.
  const ListEmpty = useMemo(
    () => (activeLane === 'groups' && isLoading ? <FeedSkeleton /> : null),
    [activeLane, isLoading],
  );

  // ── List Footer ──
  // Trailing spacer so the last worldwide card isn't flush with the tab bar.
  const ListFooter = useMemo(() => <View style={{ height: 100 }} />, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Demo challenge alert overlay */}
      <DemoChallengeAlert
        visible={showDemoAlert}
        onDismiss={() => setDemoDismissed(true)}
      />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Home</Text>
          <Zap size={20} color={theme.coral} fill={theme.coral} />
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.notifBtn}
            onPress={handleNotifications}
            testID="notifications-btn"
          >
            <Bell size={20} color={theme.text} />
            {unreadNotificationCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {unreadNotificationCount > 9
                    ? '9+'
                    : unreadNotificationCount}
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
            <AvatarRing
              uri={user.avatar}
              name={user.name}
              size={34}
              ringColor={theme.coral}
              showStatus
              hasResponded
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Lane switcher: 🔒 Groups · 🌍 World · ✨ For You */}
      <LaneTabs active={activeLane} onChange={setActiveLane} />

      {/* Feed */}
      <FlatList
        ref={flatListRef}
        data={laneData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.feedContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.coral}
          />
        }
        // Performance
        removeClippedSubviews={Platform.OS !== 'web'}
        maxToRenderPerBatch={5}
        windowSize={7}
        initialNumToRender={4}
      />
    </View>
  );
}

// ── Helper Functions ──

function buildQuizResults(
  responses: ApiChallengeResponse[],
  challenge: ChallengeHistoryItem,
): Array<{ name: string; votes: number }> {
  // If the challenge has options, tally votes by option index
  if (challenge.options && challenge.options.length > 0) {
    const tally = new Map<string, number>();
    for (const resp of responses) {
      if (resp.answer_index !== null && resp.answer_index !== undefined) {
        const label =
          challenge.options[resp.answer_index] ||
          resp.display_name ||
          'Unknown';
        tally.set(label, (tally.get(label) || 0) + 1);
      } else if (resp.answer_text) {
        tally.set(resp.answer_text, (tally.get(resp.answer_text) || 0) + 1);
      }
    }
    return Array.from(tally.entries())
      .map(([name, votes]) => ({ name, votes }))
      .sort((a, b) => b.votes - a.votes);
  }

  // For "most likely" quizzes, tally by display_name voted for
  if (challenge.type === 'quiz_most_likely') {
    const tally = new Map<string, number>();
    for (const resp of responses) {
      const votedFor = resp.answer_text || resp.display_name || 'Unknown';
      tally.set(votedFor, (tally.get(votedFor) || 0) + 1);
    }
    return Array.from(tally.entries())
      .map(([name, votes]) => ({ name, votes }))
      .sort((a, b) => b.votes - a.votes);
  }

  // Fallback: just list who answered
  return responses
    .filter((r) => r.answer_text)
    .map((r) => ({
      name: r.display_name || 'User',
      votes: 1,
    }));
}

function createFallbackItem(
  items: FeedItemData[],
  challenge: ChallengeHistoryItem,
  group: Group,
) {
  // Create a simple quiz result item as fallback
  items.push({
    id: `fallback_${challenge.id}`,
    type: 'quiz_result',
    groupName: group.name,
    groupEmoji: group.emoji,
    groupId: group.id,
    challengeId: challenge.id,
    quizQuestion: challenge.prompt || 'Challenge',
    quizResults: [
      {
        name: `${challenge.response_count} response${Number(challenge.response_count) !== 1 ? 's' : ''}`,
        votes: Number(challenge.response_count) || 0,
      },
    ],
    timeAgo: getRelativeTime(challenge.created_at),
    timestamp: challenge.created_at,
  });
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
  laneEmpty: {
    alignItems: 'center',
    paddingTop: 100,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
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
