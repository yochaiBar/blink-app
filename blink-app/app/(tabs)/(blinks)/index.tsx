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
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Zap } from 'lucide-react-native';
import { Image } from 'expo-image';
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
import { ApiChallenge } from '@/types/api';
import GlassCard from '@/components/ui/GlassCard';
import AvatarRing from '@/components/ui/AvatarRing';
import BlinkMomentCard from '@/components/BlinkMomentCard';

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

interface ChallengePreview {
  respondedCount: number;
  totalMembers: number;
  totalReactions: number;
  topReactionEmoji?: string;
  respondedUsers: Array<{
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
  }>;
}

interface FeedMoment {
  id: string;
  challengeId: string;
  groupId: string;
  groupName: string;
  groupEmoji: string;
  challengePrompt: string;
  challengeType: string;
  triggeredBy: string | null;
  timestamp: string;
  responseCount: number;
  totalMembers: number;
  isLocked: boolean;
  isActive: boolean;
  // Preview data (loaded lazily)
  totalReactions?: number;
  topReactionEmoji?: string;
  previewAvatars: Array<{ uri?: string; name: string }>;
}

interface PendingChallenge {
  group: Group;
  challenge: ApiChallenge;
}

// ── Active Challenge Banner ──

function ActiveChallengeBanner({
  pendingChallenges,
  onPress,
}: {
  pendingChallenges: PendingChallenge[];
  onPress: (pc: PendingChallenge) => void;
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.015,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
      ]),
    );
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    glow.start();
    return () => {
      pulse.stop();
      glow.stop();
    };
  }, [pulseAnim, glowAnim]);

  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onPress(pendingChallenges[0]);
  }, [pendingChallenges, onPress]);

  const count = pendingChallenges.length;
  const isSingle = count === 1;
  const first = pendingChallenges[0];

  const borderOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        styles.bannerWrapper,
        { transform: [{ scale: pulseAnim }] },
      ]}
    >
      <TouchableOpacity activeOpacity={0.85} onPress={handlePress}>
        <GlassCard
          style={styles.bannerCard}
          padding={0}
          borderRadius={borderRadius.xl}
          noBorder
        >
          {/* Coral gradient border effect */}
          <Animated.View
            style={[
              styles.bannerBorderGlow,
              { opacity: borderOpacity },
            ]}
          >
            <LinearGradient
              colors={[theme.coral, theme.coralDark, theme.coral]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <View style={styles.bannerInner}>
            {/* Live dot */}
            <View style={styles.bannerTopRow}>
              <View style={styles.liveDotContainer}>
                <Animated.View
                  style={[
                    styles.liveDot,
                    {
                      opacity: glowAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.6, 1],
                      }),
                    },
                  ]}
                />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
              <View style={styles.bannerEmojiRow}>
                {pendingChallenges.slice(0, 4).map((pc, i) => (
                  <Text key={pc.group.id} style={styles.bannerGroupEmoji}>
                    {pc.group.emoji}
                  </Text>
                ))}
              </View>
            </View>

            {isSingle ? (
              <>
                <Text style={styles.bannerTitle} numberOfLines={1}>
                  {first.group.name}
                </Text>
                <Text style={styles.bannerPrompt} numberOfLines={2}>
                  {first.challenge.prompt_text ||
                    first.challenge.prompt ||
                    'New challenge waiting!'}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.bannerTitle}>
                  {count} challenge{count > 1 ? 's' : ''} waiting
                </Text>
                <Text style={styles.bannerSubtitle} numberOfLines={1}>
                  {pendingChallenges
                    .slice(0, 3)
                    .map((pc) => pc.group.name)
                    .join(', ')}
                  {count > 3 ? ` +${count - 3} more` : ''}
                </Text>
              </>
            )}

            <View style={styles.bannerCta}>
              <Zap size={16} color={theme.white} fill={theme.white} />
              <Text style={styles.bannerCtaText}>
                {isSingle ? 'Respond now' : 'Start responding'}
              </Text>
            </View>
          </View>
        </GlassCard>
      </TouchableOpacity>
    </Animated.View>
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
          <View style={styles.skeletonHeader}>
            <View style={styles.skeletonCircle} />
            <View style={styles.skeletonLines}>
              <View style={[styles.skeletonLine, { width: 120 }]} />
              <View style={[styles.skeletonLine, { width: 80, height: 8 }]} />
            </View>
          </View>
          <View style={[styles.skeletonLine, { width: '80%', height: 18, marginTop: 12 }]} />
          <View style={[styles.skeletonLine, { width: '60%', height: 14, marginTop: 8 }]} />
          <View style={styles.skeletonAvatarRow}>
            {[0, 1, 2].map((j) => (
              <View key={j} style={styles.skeletonSmallCircle} />
            ))}
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
    user,
    unreadNotificationCount,
    refreshGroups,
    isRefreshing,
    isLoading: isGroupsLoading,
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
          // Challenge may have expired
        }
      });
      await Promise.all(fetches);
      return results;
    },
    enabled: groups.length > 0,
    staleTime: 15_000,
  });

  const pendingChallenges = activeChallengesQuery.data ?? [];

  // ── Fetch challenge history across all groups to build the feed ──
  const feedQuery = useQuery({
    queryKey: ['blinks-feed', groups.map((g) => g.id).join(',')],
    queryFn: async (): Promise<FeedMoment[]> => {
      if (groups.length === 0) return [];

      const allMoments: FeedMoment[] = [];
      const groupMap = new Map(groups.map((g) => [g.id, g]));

      // Fetch history for each group in parallel
      const fetches = groups.map(async (group) => {
        try {
          const history: ChallengeHistoryItem[] = await api(
            `/challenges/groups/${group.id}/challenges/history`,
          );
          if (!Array.isArray(history)) return;

          for (const item of history) {
            // Map members to preview avatars from group.members
            const memberAvatars = group.members
              .slice(0, 4)
              .map((m) => ({ uri: m.avatar, name: m.name }));

            allMoments.push({
              id: `${item.id}_${group.id}`,
              challengeId: item.id,
              groupId: group.id,
              groupName: group.name,
              groupEmoji: group.emoji,
              challengePrompt: item.prompt || 'Challenge',
              challengeType: item.type,
              triggeredBy: item.created_by,
              timestamp: item.created_at,
              responseCount: typeof item.response_count === 'string'
                ? parseInt(item.response_count as string, 10)
                : item.response_count,
              totalMembers: typeof item.member_count === 'string'
                ? parseInt(item.member_count as string, 10)
                : item.member_count,
              isLocked: !item.user_responded,
              isActive: false,
              previewAvatars: memberAvatars,
            });
          }
        } catch {
          // Group might not have history
        }
      });

      // Also add active challenges that user has responded to
      const activeGroupsWithChallenge = groups.filter(
        (g) => g.hasActiveChallenge,
      );
      const activeFetches = activeGroupsWithChallenge.map(async (group) => {
        try {
          const challenge: ApiChallenge = await api(
            `/challenges/groups/${group.id}/challenges/active`,
          );
          if (challenge) {
            const memberAvatars = group.members
              .slice(0, 4)
              .map((m) => ({ uri: m.avatar, name: m.name }));

            allMoments.push({
              id: `active_${challenge.id}_${group.id}`,
              challengeId: challenge.id,
              groupId: group.id,
              groupName: group.name,
              groupEmoji: group.emoji,
              challengePrompt:
                challenge.prompt_text || challenge.prompt || 'Active Challenge',
              challengeType: challenge.type,
              triggeredBy: challenge.triggered_by,
              timestamp: challenge.triggered_at,
              responseCount: 0, // will be enriched with preview
              totalMembers: group.members.length,
              isLocked: !challenge.user_has_responded,
              isActive: true,
              previewAvatars: memberAvatars,
            });
          }
        } catch {
          // No active challenge
        }
      });

      await Promise.all([...fetches, ...activeFetches]);

      // Deduplicate by challengeId (active version takes precedence)
      const seen = new Map<string, FeedMoment>();
      for (const m of allMoments) {
        const existing = seen.get(m.challengeId);
        if (!existing || m.isActive) {
          seen.set(m.challengeId, m);
        }
      }

      // Sort by most recent
      const moments = Array.from(seen.values()).sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      return moments;
    },
    enabled: groups.length > 0,
    staleTime: 30_000,
  });

  const feedMoments = feedQuery.data ?? [];

  // ── Enrich moments with preview data ──
  const [enrichedPreviews, setEnrichedPreviews] = useState<
    Map<string, ChallengePreview>
  >(new Map());

  useEffect(() => {
    // Fetch preview data for visible moments
    const momentsToEnrich = feedMoments.slice(0, 10);
    let cancelled = false;

    const fetchPreviews = async () => {
      const newPreviews = new Map(enrichedPreviews);
      let changed = false;

      await Promise.all(
        momentsToEnrich.map(async (moment) => {
          if (newPreviews.has(moment.challengeId)) return;
          try {
            const preview: ChallengePreview = await api(
              `/challenges/${moment.challengeId}/preview`,
            );
            if (!cancelled && preview) {
              newPreviews.set(moment.challengeId, preview);
              changed = true;
            }
          } catch {
            // Preview endpoint might not exist for old challenges
          }
        }),
      );

      if (changed && !cancelled) {
        setEnrichedPreviews(new Map(newPreviews));
      }
    };

    if (momentsToEnrich.length > 0) {
      fetchPreviews();
    }

    return () => {
      cancelled = true;
    };
  }, [feedMoments.map((m) => m.challengeId).join(',')]);

  // ── Socket listeners for real-time feed updates ──
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleChallengeStarted = () => {
      queryClient.invalidateQueries({ queryKey: ['feed-active-challenges'] });
      queryClient.invalidateQueries({ queryKey: ['blinks-feed'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    };

    const handleChallengeCompleted = () => {
      queryClient.invalidateQueries({ queryKey: ['feed-active-challenges'] });
      queryClient.invalidateQueries({ queryKey: ['blinks-feed'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    };

    const handleChallengeResponse = () => {
      queryClient.invalidateQueries({ queryKey: ['blinks-feed'] });
    };

    socket.on('challenge:started', handleChallengeStarted);
    socket.on('challenge:completed', handleChallengeCompleted);
    socket.on('challenge:response', handleChallengeResponse);

    return () => {
      socket.off('challenge:started', handleChallengeStarted);
      socket.off('challenge:completed', handleChallengeCompleted);
      socket.off('challenge:response', handleChallengeResponse);
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

  const handleBannerPress = useCallback(
    (pc: PendingChallenge) => {
      navigateToChallenge(pc.group, pc.challenge);
    },
    [navigateToChallenge],
  );

  const handleMomentPress = useCallback(
    (moment: FeedMoment) => {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      // Navigate to group detail to see the challenge responses
      router.push({
        pathname: '/group-detail' as never,
        params: { id: moment.groupId },
      });
    },
    [router],
  );

  const handleMomentRespond = useCallback(
    (moment: FeedMoment) => {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      const group = groups.find((g) => g.id === moment.groupId);
      if (!group) return;

      // For active challenges, route to the challenge screen
      if (moment.isActive) {
        if (
          moment.challengeType === 'snap'
        ) {
          router.push({
            pathname: '/snap-challenge' as never,
            params: { groupId: moment.groupId },
          });
        } else {
          router.push({
            pathname: '/quiz-challenge' as never,
            params: {
              groupId: moment.groupId,
              challengeId: moment.challengeId,
              type: moment.challengeType,
            },
          });
        }
      } else {
        // For past challenges, go to group detail
        router.push({
          pathname: '/group-detail' as never,
          params: { id: moment.groupId },
        });
      }
    },
    [groups, router],
  );

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      refreshGroups(),
      queryClient.invalidateQueries({ queryKey: ['blinks-feed'] }),
      queryClient.invalidateQueries({ queryKey: ['feed-active-challenges'] }),
    ]);
    setEnrichedPreviews(new Map());
  }, [refreshGroups, queryClient]);

  // ── Build enriched moments for display ──
  const displayMoments = useMemo(() => {
    return feedMoments.map((moment) => {
      const preview = enrichedPreviews.get(moment.challengeId);
      if (preview) {
        return {
          ...moment,
          responseCount:
            preview.respondedCount > 0
              ? preview.respondedCount
              : moment.responseCount,
          totalMembers:
            preview.totalMembers > 0
              ? preview.totalMembers
              : moment.totalMembers,
          totalReactions: preview.totalReactions,
          topReactionEmoji: preview.topReactionEmoji ?? undefined,
          previewAvatars:
            preview.respondedUsers.length > 0
              ? preview.respondedUsers.map((u) => ({
                  uri: u.avatar_url ?? undefined,
                  name: u.display_name ?? 'User',
                }))
              : moment.previewAvatars,
        };
      }
      return moment;
    });
  }, [feedMoments, enrichedPreviews]);

  // ── Render helpers ──

  const renderMoment = useCallback(
    ({ item }: { item: FeedMoment }) => (
      <BlinkMomentCard
        groupName={item.groupName}
        groupEmoji={item.groupEmoji}
        challengePrompt={item.challengePrompt}
        challengeType={item.challengeType}
        triggeredBy={item.triggeredBy}
        timeAgo={getRelativeTime(item.timestamp)}
        responseCount={item.responseCount}
        totalMembers={item.totalMembers}
        topReactionEmoji={item.topReactionEmoji}
        totalReactions={item.totalReactions}
        previewAvatars={item.previewAvatars}
        isLocked={item.isLocked}
        onPress={() => handleMomentPress(item)}
        onRespond={() => handleMomentRespond(item)}
      />
    ),
    [handleMomentPress, handleMomentRespond],
  );

  const keyExtractor = useCallback((item: FeedMoment) => item.id, []);

  const isLoading =
    isGroupsLoading || (groups.length > 0 && feedQuery.isLoading);
  const isEmpty = !isLoading && groups.length > 0 && displayMoments.length === 0;
  const hasNoGroups = !isGroupsLoading && groups.length === 0;

  // ── List header (banner) ──
  const ListHeader = useMemo(() => {
    if (pendingChallenges.length === 0) return null;
    return (
      <ActiveChallengeBanner
        pendingChallenges={pendingChallenges}
        onPress={handleBannerPress}
      />
    );
  }, [pendingChallenges, handleBannerPress]);

  // ── List empty ──
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
            Join or create a group to start challenging your friends
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
          <Text style={styles.emptyTitle}>No moments yet</Text>
          <Text style={styles.emptySubtitle}>
            When challenges are completed in your groups, they will appear here
            as blink moments. Check back soon!
          </Text>
        </View>
      );
    }
    return null;
  }, [isLoading, hasNoGroups, isEmpty, router]);

  // ── List footer ──
  const ListFooter = useMemo(() => {
    if (displayMoments.length === 0) return null;
    return (
      <View style={styles.footerContainer}>
        <Text style={styles.footerText}>
          {displayMoments.length} moment{displayMoments.length !== 1 ? 's' : ''}{' '}
          across {groups.length} group{groups.length !== 1 ? 's' : ''}
        </Text>
        <View style={{ height: 100 }} />
      </View>
    );
  }, [displayMoments.length, groups.length]);

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
        data={displayMoments}
        renderItem={renderMoment}
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
        // Performance optimizations
        removeClippedSubviews={Platform.OS !== 'web'}
        maxToRenderPerBatch={6}
        windowSize={7}
        initialNumToRender={5}
        getItemLayout={undefined}
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
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    flexGrow: 1,
  },

  // Banner
  bannerWrapper: {
    marginBottom: spacing.lg,
  },
  bannerCard: {
    position: 'relative',
    overflow: 'hidden',
  },
  bannerBorderGlow: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: borderRadius.xl + 1,
    zIndex: -1,
  },
  bannerInner: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  bannerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  liveDotContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.coral,
  },
  liveText: {
    ...typography.labelSmall,
    color: theme.coral,
  },
  bannerEmojiRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  bannerGroupEmoji: {
    fontSize: 18,
  },
  bannerTitle: {
    ...typography.headlineLarge,
    color: theme.text,
  },
  bannerPrompt: {
    ...typography.bodyMedium,
    color: theme.textSecondary,
  },
  bannerSubtitle: {
    ...typography.bodyMedium,
    color: theme.textSecondary,
  },
  bannerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: theme.coral,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  bannerCtaText: {
    ...typography.labelLarge,
    color: theme.white,
    fontWeight: '700',
  },

  // Skeleton
  skeletonContainer: {
    gap: spacing.md,
    paddingTop: spacing.lg,
  },
  skeletonCard: {
    backgroundColor: theme.bgCardSolid,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
  },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
  skeletonAvatarRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  skeletonSmallCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.surface,
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
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  emptyActionGradient: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  emptyActionText: {
    ...typography.labelLarge,
    color: theme.white,
    fontWeight: '700',
  },

  // Footer
  footerContainer: {
    alignItems: 'center',
    paddingTop: spacing.xl,
  },
  footerText: {
    ...typography.bodySmall,
    color: theme.textMuted,
  },
});
