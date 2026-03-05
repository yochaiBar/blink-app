import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Platform, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Bell, UserPlus } from 'lucide-react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import GroupCard from '@/components/GroupCard';
import HomeHeroCard from '@/components/HomeHeroCard';
import QuickActionCards from '@/components/QuickActionCards';
import Tooltip, { TargetLayout } from '@/components/Tooltip';
import { useOnboardingStore, tourMessages } from '@/stores/onboardingStore';
import { isDemoGroup } from '@/constants/demoData';
import { getTimeGreeting } from '@/utils/time';
import { GroupCardSkeleton, EmptyState, ErrorState } from '@/components/ui';

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { groups, user, unreadNotificationCount, refreshGroups, isRefreshing, isLoading, shouldShowDemoGroup } = useApp();
  const fabScale = useRef(new Animated.Value(1)).current;

  const tourStep = useOnboardingStore((s) => s.tourStep);
  const tourComplete = useOnboardingStore((s) => s.tourComplete);
  const startTour = useOnboardingStore((s) => s.startTour);
  const advanceTour = useOnboardingStore((s) => s.advanceTour);
  const completeTour = useOnboardingStore((s) => s.completeTour);

  const [demoCardLayout, setDemoCardLayout] = useState<TargetLayout | null>(null);
  const [fabLayout, setFabLayout] = useState<TargetLayout | null>(null);
  const demoCardRef = useRef<View>(null);
  const fabRef = useRef<View>(null);

  // Start tour when demo group is showing and tour hasn't begun
  useEffect(() => {
    if (shouldShowDemoGroup && !tourComplete && tourStep === null) {
      const timer = setTimeout(() => startTour(), 500);
      return () => clearTimeout(timer);
    }
  }, [shouldShowDemoGroup, tourComplete, tourStep, startTour]);

  // Measure demo card position for tooltip
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

  // Measure FAB position for tooltip
  useEffect(() => {
    if (tourStep === 'fab' && fabRef.current) {
      const timer = setTimeout(() => {
        fabRef.current?.measureInWindow((x, y, width, height) => {
          if (width > 0) setFabLayout({ x, y, width, height });
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

  const handleInviteFriends = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    // Pass the first group's ID so invite-members can show the invite code
    const firstGroup = groups.find(g => !isDemoGroup(g.id));
    if (firstGroup) {
      router.push({ pathname: '/invite-members' as never, params: { groupId: firstGroup.id } });
    } else {
      // No real groups — prompt to create one first
      router.push('/create-group' as never);
    }
  }, [router, groups]);

  const handleGroupPress = useCallback((groupId: string) => {
    router.push({ pathname: '/group-detail' as never, params: { id: groupId } });
  }, [router]);

  const handleNotifications = useCallback(() => {
    router.push('/notifications' as never);
  }, [router]);

  const handleFabPressIn = useCallback(() => {
    Animated.spring(fabScale, {
      toValue: 0.9,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [fabScale]);

  const handleFabPressOut = useCallback(() => {
    Animated.spring(fabScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [fabScale]);

  // Tour tooltip handlers
  const handleHomeTourNext = useCallback(() => {
    advanceTour('group_detail');
    const demoGroup = groups.find((g) => isDemoGroup(g.id));
    if (demoGroup) {
      router.push({ pathname: '/group-detail' as never, params: { id: demoGroup.id } });
    }
  }, [advanceTour, groups, router]);

  const handleFabTourNext = useCallback(() => {
    completeTour();
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push('/create-group' as never);
  }, [completeTour, router]);

  const activeGroups = groups.filter(g => g.hasActiveChallenge);
  const otherGroups = groups.filter(g => !g.hasActiveChallenge);

  // Sort active groups by soonest deadline
  const sortedActiveGroups = useMemo(() =>
    [...activeGroups].sort((a, b) => (a.challengeEndTime ?? Infinity) - (b.challengeEndTime ?? Infinity)),
    [activeGroups]
  );

  // Determine hero mode
  const heroMode = useMemo(() => {
    if (groups.length === 0) return 'welcome' as const;
    if (sortedActiveGroups.length > 0) return 'challenge' as const;
    return 'summary' as const;
  }, [groups.length, sortedActiveGroups.length]);

  // The first active group drives the challenge hero
  const heroActiveGroup = sortedActiveGroups[0];
  // Remaining active groups render as normal cards
  const remainingActiveGroups = sortedActiveGroups.slice(1);

  const handleRespondChallenge = useCallback(() => {
    if (!heroActiveGroup) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push({ pathname: '/snap-challenge' as never, params: { groupId: heroActiveGroup.id } });
  }, [heroActiveGroup, router]);

  // Dynamic greeting
  const greeting = getTimeGreeting();

  const subtitleText = useMemo(() => {
    if (groups.length === 0) return "Let's get started";
    if (activeGroups.length > 0) return `${activeGroups.length} challenge${activeGroups.length > 1 ? 's' : ''} waiting`;
    return 'All caught up!';
  }, [groups.length, activeGroups.length]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            {greeting.text}, {user.name?.split(' ')[0] || 'there'} {greeting.emoji}
          </Text>
          <Text style={styles.subtitle}>{subtitleText}</Text>
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
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(tabs)/profile' as never)}>
            <Image source={{ uri: user.avatar }} style={styles.headerAvatar} contentFit="cover" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refreshGroups}
            tintColor={theme.coral}
          />
        }
      >
        <HomeHeroCard
          mode={heroMode}
          user={user}
          activeGroup={heroActiveGroup}
          groupCount={groups.length}
          onCreateGroup={handleCreateGroup}
          onJoinGroup={handleJoinGroup}
          onRespondChallenge={handleRespondChallenge}
        />

        {heroMode === 'summary' && (
          <QuickActionCards
            onInviteFriends={handleInviteFriends}
            onCreateGroup={handleCreateGroup}
            onJoinGroup={handleJoinGroup}
          />
        )}

        {isLoading ? (
          <View style={styles.section}>
            <GroupCardSkeleton />
            <GroupCardSkeleton />
            <GroupCardSkeleton />
          </View>
        ) : groups.length === 0 && !shouldShowDemoGroup ? (
          <EmptyState
            emoji="👋"
            title="Welcome to Blink!"
            subtitle="Create or join a group to get started"
            actionLabel="Create Group"
            onAction={handleCreateGroup}
          />
        ) : (
          <>
            {remainingActiveGroups.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.liveDot} />
                  <Text style={styles.sectionTitle}>Active Challenges</Text>
                </View>
                {remainingActiveGroups.map(group => (
                  <View
                    key={group.id}
                    ref={isDemoGroup(group.id) ? demoCardRef : undefined}
                    collapsable={false}
                  >
                    <GroupCard
                      group={group}
                      onPress={() => handleGroupPress(group.id)}
                    />
                  </View>
                ))}
              </View>
            )}

            {otherGroups.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Your Groups</Text>
                {otherGroups.map(group => (
                  <View
                    key={group.id}
                    ref={isDemoGroup(group.id) ? demoCardRef : undefined}
                    collapsable={false}
                  >
                    <GroupCard
                      group={group}
                      onPress={() => handleGroupPress(group.id)}
                    />
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {heroMode !== 'welcome' && (
        <View style={[styles.fabColumn, { bottom: 24 + insets.bottom }]}>
          <TouchableOpacity
            style={styles.fabSecondary}
            onPress={handleJoinGroup}
            activeOpacity={0.85}
            testID="join-group-fab"
          >
            <UserPlus size={20} color={theme.coral} />
          </TouchableOpacity>
          <Animated.View style={{ transform: [{ scale: fabScale }] }}>
            <View ref={fabRef} collapsable={false}>
              <TouchableOpacity
                style={styles.fab}
                onPress={handleCreateGroup}
                onPressIn={handleFabPressIn}
                onPressOut={handleFabPressOut}
                activeOpacity={1}
                testID="create-group-fab"
              >
                <Plus size={24} color={theme.white} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      )}

      {/* Tour Tooltip: Step 1 — Demo group card */}
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

      {/* Tour Tooltip: Step 3 — FAB */}
      <Tooltip
        visible={tourStep === 'fab'}
        message={tourMessages.fab}
        targetLayout={fabLayout}
        position="above"
        onNext={handleFabTourNext}
        onDismiss={completeTour}
        nextLabel="Create group"
        step={3}
        totalSteps={3}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: theme.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginTop: 3,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
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
    top: 4,
    right: 4,
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
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: theme.coral,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  section: {
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.coral,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: theme.textSecondary,
    letterSpacing: 0.3,
    marginBottom: 12,
  },
  fabColumn: {
    position: 'absolute',
    right: 20,
    alignItems: 'center',
    gap: 12,
  },
  fabSecondary: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: theme.coral,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: theme.coral,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
});
