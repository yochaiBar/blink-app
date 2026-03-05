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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Users, Plus, UserPlus } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import { useApp } from '@/providers/AppProvider';
import { getRelativeTime } from '@/utils/time';
import { Group } from '@/types';
import GlassCard from '@/components/ui/GlassCard';
import AvatarRing from '@/components/ui/AvatarRing';
import { GroupCardSkeleton } from '@/components/ui';
import StreakIcon from '@/components/StreakIcon';
import Tooltip, { TargetLayout } from '@/components/Tooltip';
import { useOnboardingStore, tourMessages } from '@/stores/onboardingStore';
import { isDemoGroup } from '@/constants/demoData';

// ── Simplified Group Card ──

const GroupListCard = React.memo(function GroupListCard({
  group,
  onPress,
}: {
  group: Group;
  onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  }, [onPress]);

  const topStreak = useMemo(
    () => group.members.reduce((max, m) => Math.max(max, m.streak), 0),
    [group.members],
  );

  const displayedMembers = group.members.slice(0, 5);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        activeOpacity={1}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        testID={`group-card-${group.id}`}
      >
        <GlassCard
          style={styles.groupCard}
          padding={0}
          borderRadius={borderRadius.xl}
        >
          <View style={styles.groupCardInner}>
            {/* Top section: emoji, name, meta */}
            <View style={styles.groupTopRow}>
              <View style={styles.groupEmojiCircle}>
                <Text style={styles.groupEmoji}>{group.emoji}</Text>
              </View>

              <View style={styles.groupInfo}>
                <View style={styles.groupNameRow}>
                  <Text style={styles.groupName} numberOfLines={1}>
                    {group.name}
                  </Text>
                  {group.hasActiveChallenge && (
                    <View style={styles.activeDot} />
                  )}
                </View>

                <View style={styles.groupMetaRow}>
                  <Text style={styles.groupMeta}>
                    {group.members.length} member
                    {group.members.length !== 1 ? 's' : ''}
                  </Text>

                  {topStreak > 0 && (
                    <>
                      <Text style={styles.groupMetaDot}>{'\u00B7'}</Text>
                      <StreakIcon streak={topStreak} size={13} />
                      <Text style={styles.streakText}>{topStreak} days</Text>
                    </>
                  )}

                  <Text style={styles.groupMetaDot}>{'\u00B7'}</Text>
                  <Text style={styles.groupMeta}>
                    {getRelativeTime(group.lastActive)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Bottom section: member avatars */}
            <View style={styles.memberRow}>
              {displayedMembers.map((member, i) => (
                <View
                  key={member.id}
                  style={[
                    styles.memberAvatar,
                    { marginLeft: i > 0 ? -6 : 0, zIndex: 10 - i },
                  ]}
                >
                  <AvatarRing
                    uri={member.avatar}
                    name={member.name}
                    size={24}
                    ringColor={
                      member.isOnline ? theme.green : theme.border
                    }
                    showStatus
                    hasResponded={member.isOnline}
                  />
                </View>
              ))}
              {group.members.length > 5 && (
                <View style={styles.moreMembers}>
                  <Text style={styles.moreMembersText}>
                    +{group.members.length - 5}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </GlassCard>
      </TouchableOpacity>
    </Animated.View>
  );
});

// ── Main Groups Screen ──

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    groups,
    refreshGroups,
    isRefreshing,
    isLoading,
    shouldShowDemoGroup,
  } = useApp();

  // Onboarding tour
  const tourStep = useOnboardingStore((s) => s.tourStep);
  const tourComplete = useOnboardingStore((s) => s.tourComplete);
  const startTour = useOnboardingStore((s) => s.startTour);
  const advanceTour = useOnboardingStore((s) => s.advanceTour);
  const completeTour = useOnboardingStore((s) => s.completeTour);

  const [demoCardLayout, setDemoCardLayout] = useState<TargetLayout | null>(
    null,
  );
  const demoCardRef = useRef<View>(null);

  useEffect(() => {
    if (shouldShowDemoGroup && !tourComplete && tourStep === null) {
      const timer = setTimeout(() => startTour(), 500);
      return () => clearTimeout(timer);
    }
  }, [shouldShowDemoGroup, tourComplete, tourStep, startTour]);

  useEffect(() => {
    if (tourStep === 'home' && demoCardRef.current) {
      const timer = setTimeout(() => {
        demoCardRef.current?.measureInWindow((x, y, width, height) => {
          if (width > 0) setDemoCardLayout({ x, y, width, height });
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [tourStep]);

  const handleCreateGroup = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push('/create-group' as never);
  }, [router]);

  const handleJoinGroup = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push('/join-group' as never);
  }, [router]);

  const handleGroupPress = useCallback(
    (groupId: string) => {
      router.push({
        pathname: '/group-detail' as never,
        params: { id: groupId },
      });
    },
    [router],
  );

  const handleHomeTourNext = useCallback(() => {
    advanceTour('group_detail');
    const demoGroup = groups.find((g) => isDemoGroup(g.id));
    if (demoGroup) {
      router.push({
        pathname: '/group-detail' as never,
        params: { id: demoGroup.id },
      });
    }
  }, [advanceTour, groups, router]);

  // Sort: active challenge groups first, then by last active
  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => {
      if (a.hasActiveChallenge && !b.hasActiveChallenge) return -1;
      if (!a.hasActiveChallenge && b.hasActiveChallenge) return 1;
      return (
        new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime()
      );
    });
  }, [groups]);

  const renderGroup = useCallback(
    ({ item, index }: { item: Group; index: number }) => {
      const isDemo = isDemoGroup(item.id);
      return (
        <View
          ref={isDemo ? demoCardRef : undefined}
          collapsable={false}
        >
          <GroupListCard
            group={item}
            onPress={() => handleGroupPress(item.id)}
          />
        </View>
      );
    },
    [handleGroupPress],
  );

  const keyExtractor = useCallback((item: Group) => item.id, []);

  const hasGroups = groups.length > 0;

  // ── List Footer: Create/Join buttons + spacer ──
  const ListFooter = useMemo(() => {
    return (
      <View style={styles.footerSection}>
        {/* Create Group button */}
        <TouchableOpacity
          style={styles.createBtn}
          onPress={handleCreateGroup}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[theme.coral, theme.coralDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.createBtnGradient}
          >
            <Plus size={20} color={theme.white} />
            <Text style={styles.createBtnText}>Create Group</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Join with Code */}
        <TouchableOpacity
          style={styles.joinBtn}
          onPress={handleJoinGroup}
          activeOpacity={0.7}
        >
          <UserPlus size={16} color={theme.coral} />
          <Text style={styles.joinBtnText}>Join with Code</Text>
        </TouchableOpacity>

        <View style={{ height: 100 }} />
      </View>
    );
  }, [handleCreateGroup, handleJoinGroup]);

  // ── List Empty ──
  const ListEmpty = useMemo(() => {
    if (isLoading) {
      return (
        <View style={styles.skeletonContainer}>
          <GroupCardSkeleton />
          <GroupCardSkeleton />
          <GroupCardSkeleton />
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconContainer}>
          <Users size={48} color={theme.textMuted} />
        </View>
        <Text style={styles.emptyTitle}>No groups yet</Text>
        <Text style={styles.emptySubtitle}>
          Create or join a group to start sharing blinks with friends
        </Text>

        <TouchableOpacity
          style={styles.emptyCreateBtn}
          onPress={handleCreateGroup}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[theme.coral, theme.coralDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.emptyCreateBtnGradient}
          >
            <Plus size={20} color={theme.white} />
            <Text style={styles.emptyCreateBtnText}>Create Group</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.emptyJoinBtn}
          onPress={handleJoinGroup}
          activeOpacity={0.7}
        >
          <Text style={styles.emptyJoinBtnText}>Join with Code</Text>
        </TouchableOpacity>
      </View>
    );
  }, [isLoading, handleCreateGroup, handleJoinGroup]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Users size={22} color={theme.coral} />
          <Text style={styles.headerTitle}>Groups</Text>
        </View>
        {hasGroups && (
          <Text style={styles.groupCount}>
            {groups.length} group{groups.length !== 1 ? 's' : ''}
          </Text>
        )}
      </View>

      {/* Group List */}
      <FlatList
        data={hasGroups ? sortedGroups : []}
        renderItem={renderGroup}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={hasGroups ? ListFooter : null}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refreshGroups}
            tintColor={theme.coral}
          />
        }
        removeClippedSubviews={Platform.OS !== 'web'}
        maxToRenderPerBatch={10}
        initialNumToRender={8}
      />

      {/* Tour Tooltip */}
      <Tooltip
        visible={tourStep === 'home'}
        message={tourMessages.home}
        targetLayout={demoCardLayout}
        position="below"
        onNext={handleHomeTourNext}
        onDismiss={completeTour}
        nextLabel="Let's go"
        step={1}
        totalSteps={3}
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
    paddingVertical: spacing.lg,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: theme.text,
    letterSpacing: -0.5,
  },
  groupCount: {
    ...typography.bodySmall,
    color: theme.textMuted,
    fontWeight: '600',
  },

  // List
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    flexGrow: 1,
  },

  // Group Card
  groupCard: {
    marginBottom: spacing.md,
  },
  groupCardInner: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  groupTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  groupEmojiCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupEmoji: {
    fontSize: 24,
  },
  groupInfo: {
    flex: 1,
    gap: 3,
  },
  groupNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  groupName: {
    ...typography.headlineMedium,
    color: theme.text,
    flexShrink: 1,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.coral,
  },
  groupMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  groupMeta: {
    ...typography.bodySmall,
    color: theme.textMuted,
  },
  groupMetaDot: {
    ...typography.bodySmall,
    color: theme.textMuted,
  },
  streakText: {
    ...typography.bodySmall,
    color: theme.yellow,
    fontWeight: '600',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 2,
  },
  memberAvatar: {},
  moreMembers: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -6,
    zIndex: 0,
  },
  moreMembersText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: theme.textSecondary,
  },

  // Footer
  footerSection: {
    paddingTop: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  createBtn: {
    width: '100%',
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  createBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.lg,
  },
  createBtnText: {
    ...typography.labelLarge,
    color: theme.white,
    fontWeight: '700',
    fontSize: 16,
  },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  joinBtnText: {
    ...typography.labelLarge,
    color: theme.coral,
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
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
  emptyCreateBtn: {
    width: '100%',
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  emptyCreateBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.lg,
  },
  emptyCreateBtnText: {
    ...typography.labelLarge,
    color: theme.white,
    fontWeight: '700',
    fontSize: 16,
  },
  emptyJoinBtn: {
    paddingVertical: spacing.lg,
  },
  emptyJoinBtnText: {
    ...typography.labelLarge,
    color: theme.coral,
  },

  // Skeleton
  skeletonContainer: {
    gap: spacing.md,
    paddingTop: spacing.lg,
  },
});
