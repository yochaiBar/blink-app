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
  ScrollView,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
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
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Active Challenge Pills ──

function ActiveChallengePills({
  pendingChallenges,
  onPress,
}: {
  pendingChallenges: PendingChallenge[];
  onPress: (pc: PendingChallenge) => void;
}) {
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1600,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 1600,
          useNativeDriver: true,
        }),
      ]),
    );
    glow.start();
    return () => glow.stop();
  }, [glowAnim]);

  const pillOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1],
  });

  return (
    <View style={styles.pillsContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillsContent}
      >
        {pendingChallenges.map((pc) => (
          <Animated.View key={pc.group.id} style={{ opacity: pillOpacity }}>
            <TouchableOpacity
              style={styles.pill}
              activeOpacity={0.8}
              onPress={() => {
                if (Platform.OS !== 'web') {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                }
                onPress(pc);
              }}
            >
              <LinearGradient
                colors={[theme.coral, theme.coralDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.pillGradient}
              >
                <Text style={styles.pillEmoji}>{pc.group.emoji}</Text>
                <Text style={styles.pillText}>Respond</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}

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

// ── Main Screen ──

export default function BlinksScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    groups,
    user,
    unreadNotificationCount,
    refreshGroups,
    isRefreshing,
    isLoading: isGroupsLoading,
    addReaction,
  } = useApp();

  // ── Fetch active challenges across all groups ──
  const activeChallengesQuery = useQuery({
    queryKey: ['feed-active-challenges', groups.map((g) => g.id).join(',')],
    queryFn: async (): Promise<PendingChallenge[]> => {
      const results: PendingChallenge[] = [];
      const groupsWithChallenge = groups.filter((g) => g.hasActiveChallenge);
      const fetches = groupsWithChallenge.map(async (group) => {
        try {
          const challenge: ApiChallenge = await api(
            `/challenges/groups/${group.id}/challenges/active`,
          );
          if (challenge && !challenge.user_has_responded) {
            results.push({ group, challenge });
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
  });

  const pendingChallenges = activeChallengesQuery.data ?? [];

  // ── Build the feed from challenge history + individual responses ──
  const feedQuery = useQuery({
    queryKey: ['blinks-feed-v2', groups.map((g) => g.id).join(',')],
    queryFn: async (): Promise<FeedItemData[]> => {
      if (groups.length === 0) return [];

      const allItems: FeedItemData[] = [];
      const groupMap = new Map(groups.map((g) => [g.id, g]));

      // Fetch history + responses for each group in parallel
      const fetches = groups.map(async (group) => {
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
                      });
                    }
                  }
                }
              } catch {
                // Responses endpoint failed -- create a summary card
                createFallbackItem(allItems, challenge, group);
              }
            } else {
              // User has NOT responded -- locked item
              allItems.push({
                id: `locked_${challenge.id}`,
                type: 'locked_photo',
                userName: `${challenge.response_count} friend${Number(challenge.response_count) !== 1 ? 's' : ''}`,
                userAvatar: undefined,
                groupName: group.name,
                groupEmoji: group.emoji,
                groupId: group.id,
                challengeId: challenge.id,
                challengePrompt: challenge.prompt || undefined,
                timeAgo: getRelativeTime(challenge.created_at),
              });
            }
          });

          await Promise.all(challengeFetches);
        } catch {
          // Non-critical: group may not have challenge history yet
        }
      });

      // Fetch spotlights for each group
      const spotlightFetches = groups.map(async (group) => {
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

  // Post-process: sort, deduplicate, and inject AI commentary
  const feedItems = useMemo(() => {
    const items = feedQuery.data ?? [];
    if (items.length === 0) return items;

    // Deduplicate by id
    const seen = new Set<string>();
    const unique: FeedItemData[] = [];
    for (const item of items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        unique.push(item);
      }
    }

    // Sort: locked items last among same timeAgo, otherwise keep insertion order
    // (insertion order is already grouped by group then by challenge recency)
    // Shuffle for a more feed-like feel: interleave different groups
    const shuffled = interleaveByGroup(unique);

    // Inject AI commentary every ~6 items if we have enough content
    const withCommentary = injectAICommentary(shuffled);

    return withCommentary;
  }, [feedQuery.data]);

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

  const handlePillPress = useCallback(
    (pc: PendingChallenge) => {
      navigateToChallenge(pc.group, pc.challenge);
    },
    [navigateToChallenge],
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

  // ── Wire up callbacks into feed items ──
  const feedItemsWithCallbacks = useMemo(() => {
    return feedItems.map((item) => ({
      ...item,
      onPress: () => handleFeedItemPress(item),
      onRespond: () => handleFeedItemRespond(item),
      onReact: (emoji: string) => handleReact(item, emoji),
    }));
  }, [feedItems, handleFeedItemPress, handleFeedItemRespond, handleReact]);

  // ── Render ──

  const renderItem = useCallback(
    ({ item }: { item: FeedItemData }) => <AnimatedFeedItem item={item} />,
    [],
  );

  const keyExtractor = useCallback((item: FeedItemData) => item.id, []);

  const isLoading =
    isGroupsLoading || (groups.length > 0 && feedQuery.isLoading);
  const isEmpty =
    !isLoading && groups.length > 0 && feedItemsWithCallbacks.length === 0;
  const hasNoGroups = !isGroupsLoading && groups.length === 0;

  // ── List Header ──
  const ListHeader = useMemo(() => {
    if (pendingChallenges.length === 0) return null;
    return (
      <ActiveChallengePills
        pendingChallenges={pendingChallenges}
        onPress={handlePillPress}
      />
    );
  }, [pendingChallenges, handlePillPress]);

  // ── List Empty ──
  const ListEmpty = useMemo(() => {
    if (isLoading) {
      return <FeedSkeleton />;
    }
    if (hasNoGroups) {
      return (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconContainer}>
            <Zap size={48} color={theme.coral} fill={theme.coral} />
          </View>
          <Text style={styles.emptyTitle}>No blinks yet</Text>
          <Text style={styles.emptySubtitle}>
            Join or create a group to start sharing moments with friends
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
              <Text style={styles.emptyActionText}>Go to Groups</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      );
    }
    if (isEmpty) {
      return (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconContainer}>
            <Zap size={48} color={theme.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>Your feed is empty</Text>
          <Text style={styles.emptySubtitle}>
            When friends respond to challenges, their photos and answers will
            show up here. Start a challenge to get things going!
          </Text>
        </View>
      );
    }
    return null;
  }, [isLoading, hasNoGroups, isEmpty, router]);

  // ── List Footer ──
  const ListFooter = useMemo(() => {
    if (feedItemsWithCallbacks.length === 0) return null;
    return (
      <View style={styles.footerContainer}>
        <Text style={styles.footerText}>You are all caught up</Text>
        <View style={{ height: 100 }} />
      </View>
    );
  }, [feedItemsWithCallbacks.length]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Blinks</Text>
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

      {/* Feed */}
      <FlatList
        data={feedItemsWithCallbacks}
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
  });
}

function interleaveByGroup(items: FeedItemData[]): FeedItemData[] {
  if (items.length <= 1) return items;

  // Group items by groupId
  const byGroup = new Map<string, FeedItemData[]>();
  const noGroup: FeedItemData[] = [];
  for (const item of items) {
    const gid = item.groupId || '__none__';
    if (gid === '__none__') {
      noGroup.push(item);
    } else {
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid)!.push(item);
    }
  }

  // Round-robin interleave
  const queues = Array.from(byGroup.values());
  const result: FeedItemData[] = [];
  let idx = 0;
  let maxLen = Math.max(...queues.map((q) => q.length), 0);
  for (let round = 0; round < maxLen; round++) {
    for (const queue of queues) {
      if (round < queue.length) {
        result.push(queue[round]);
      }
    }
  }

  // Append no-group items
  result.push(...noGroup);
  return result;
}

function injectAICommentary(items: FeedItemData[]): FeedItemData[] {
  if (items.length < 5) return items;

  const result: FeedItemData[] = [];
  const aiCommentaries = [
    'Your group is on fire today. 3 people already responded.',
    'Looks like everyone chose the same answer. Basic.',
    'This might be the best photo round yet.',
    'Someone took that challenge way too seriously.',
    'The vibes in this group are unmatched today.',
  ];

  // Collect unique group names for commentary context
  const groupNames = Array.from(
    new Set(items.filter((i) => i.groupName).map((i) => i.groupName!)),
  );

  let commentaryIdx = 0;
  for (let i = 0; i < items.length; i++) {
    result.push(items[i]);
    // Insert AI commentary every 6 items
    if ((i + 1) % 6 === 0 && commentaryIdx < aiCommentaries.length) {
      const targetGroup =
        groupNames[commentaryIdx % groupNames.length] || 'your group';
      result.push({
        id: `ai_commentary_${i}`,
        type: 'ai_commentary',
        groupName: targetGroup,
        commentary: aiCommentaries[commentaryIdx],
      });
      commentaryIdx++;
    }
  }
  return result;
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

  // Pills
  pillsContainer: {
    marginBottom: spacing.lg,
  },
  pillsContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  pill: {
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  pillGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.full,
  },
  pillEmoji: {
    fontSize: 16,
  },
  pillText: {
    ...typography.labelLarge,
    color: theme.white,
    fontWeight: '700',
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
