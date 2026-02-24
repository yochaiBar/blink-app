import React, { useCallback, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, RefreshControl, Modal, Alert, Share } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { ArrowLeft, Camera, MoreHorizontal, Share2, Trophy, UserPlus, Zap, X, LogOut, Edit3, Trash2, Clock } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import SnapCard from '@/components/SnapCard';
import { categoryLabels } from '@/constants/categories';
import { api } from '@/services/api';
import { ApiGroupDetail, ApiChallenge, ApiChallengeResponse } from '@/types/api';
import { apiGroupDetailToGroup, apiResponseToSnap } from '@/utils/adapters';
import { isDemoGroup, DEMO_GROUP_DETAIL, DEMO_CHALLENGE, DEMO_RESPONSES } from '@/constants/demoData';
import { useOnboardingStore } from '@/stores/onboardingStore';
import Tooltip, { TargetLayout } from '@/components/Tooltip';

type ChallengeType = 'snap' | 'food_quiz' | 'most_likely' | 'rate_day';

const challengeTypes: { type: ChallengeType; emoji: string; label: string }[] = [
  { type: 'snap', emoji: '📸', label: 'Snap Challenge' },
  { type: 'food_quiz', emoji: '🍔', label: 'Food Quiz' },
  { type: 'most_likely', emoji: '👀', label: 'Most Likely To' },
  { type: 'rate_day', emoji: '⭐', label: 'Rate Your Day' },
];

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
  const [challengeBarLayout, setChallengeBarLayout] = useState<TargetLayout | null>(null);
  const challengeBarRef = useRef<View>(null);

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
      const responses: ApiChallengeResponse[] = await api(`/challenges/${activeChallenge!.id}/responses`);
      return responses;
    },
    enabled: isDemo ? !!id : !!activeChallenge?.id,
    staleTime: isDemo ? Infinity : undefined,
  });

  // Build UI group from API detail
  const group = groupQuery.data
    ? apiGroupDetailToGroup(groupQuery.data, activeChallenge)
    : null;

  const snaps = (responsesQuery.data ?? []).map((r) => ({
    ...apiResponseToSnap(r),
    groupId: id ?? '',
  }));

  const hasSubmittedToday = isDemo ? false : snaps.some((s) => s.userId === user.id);

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
      } else if (type === 'food_quiz' || type === 'most_likely' || type === 'rate_day') {
        router.push({
          pathname: '/quiz-challenge' as never,
          params: {
            groupId: id,
            challengeId: data?.id ?? '',
            type,
            promptText: data?.prompt ?? '',
            optionsJson: JSON.stringify(data?.options ?? []),
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
    Alert.alert('Delete Group', 'Are you sure? This action cannot be undone and all members will lose access.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteMutation.mutate(),
      },
    ]);
  }, [deleteMutation]);

  const handleLeaveGroup = useCallback(() => {
    setShowGroupMenu(false);
    Alert.alert('Leave Group', 'Are you sure? You will need an invite to rejoin.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/groups/${id}/leave`, { method: 'POST' });
            queryClient.invalidateQueries({ queryKey: ['groups'] });
            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            router.back();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to leave group';
            Alert.alert('Error', message);
          }
        },
      },
    ]);
  }, [id, queryClient, router]);

  const handleShareGroup = useCallback(() => {
    setShowGroupMenu(false);
    Share.share({
      message: `Join my group "${group?.name}" on Blink! Use invite code: ${group?.inviteCode}`,
    });
  }, [group?.name, group?.inviteCode]);

  const handleEditGroup = useCallback(() => {
    setShowGroupMenu(false);
    Alert.alert('Coming Soon', 'Group editing will be available in a future update.');
  }, []);

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
      activeChallenge?.type === 'food_quiz' ||
      activeChallenge?.type === 'most_likely' ||
      activeChallenge?.type === 'rate_day'
    ) {
      router.push({
        pathname: '/quiz-challenge' as never,
        params: {
          groupId: id,
          challengeId: activeChallenge.id,
          type: activeChallenge.type,
          promptText: activeChallenge.prompt ?? '',
          optionsJson: JSON.stringify(activeChallenge.options ?? []),
          expiresAt: activeChallenge.expires_at,
        },
      });
    } else {
      // Fallback for unknown types
      router.push({ pathname: '/group-prompt' as never, params: { groupId: id } });
    }
  }, [router, id, activeChallenge, isDemo, advanceTour]);

  const handleReaction = useCallback((snapId: string, emoji: string) => {
    addReaction(snapId, emoji);
  }, [addReaction]);

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
    if (activeChallenge?.id) responsesQuery.refetch();
  }, [groupQuery, challengeQuery, responsesQuery, activeChallenge, isDemo]);

  // Tour tooltip handler for step 2
  const handleGroupDetailTourNext = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    advanceTour('fab');
    router.back();
  }, [advanceTour, router]);

  if (groupQuery.isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (!group) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>😅</Text>
          <Text style={styles.emptyTitle}>Group not found</Text>
          <Text style={styles.emptySubtext}>It may have been deleted or you lost access.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerEmoji}>{group.emoji}</Text>
          <Text style={styles.headerTitle}>{group.name}</Text>
        </View>
        <View style={styles.headerActions}>
          {!isDemo && (
            <>
              <TouchableOpacity
                style={styles.headerActionBtn}
                onPress={() => router.push({ pathname: '/invite-members' as never, params: { groupId: id } })}
              >
                <UserPlus size={18} color={theme.text} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerActionBtn} onPress={handleGroupMenu}>
                <MoreHorizontal size={18} color={theme.text} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <View style={styles.groupMeta}>
        <View style={[styles.categoryBadge, { backgroundColor: `${group.color}20` }]}>
          <Text style={[styles.categoryText, { color: group.color }]}>
            {categoryLabels[group.category]}
          </Text>
        </View>
        <View style={styles.membersPreview}>
          {group.members.slice(0, 6).map((member, i) => (
            <Image
              key={member.id}
              source={{ uri: member.avatar }}
              style={[styles.memberAvatar, { marginLeft: i > 0 ? -8 : 0, zIndex: 6 - i }]}
              contentFit="cover"
            />
          ))}
          <Text style={styles.memberCount}>{group.members.length} members</Text>
        </View>
      </View>

      {!isDemo && (
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: theme.yellowMuted }]}
            onPress={() => router.push({ pathname: '/group-leaderboard' as never, params: { groupId: id } })}
          >
            <Trophy size={16} color={theme.yellow} />
            <Text style={[styles.quickActionText, { color: theme.yellow }]}>Leaderboard</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: theme.greenMuted }]}
            onPress={() => router.push({ pathname: '/invite-members' as never, params: { groupId: id } })}
          >
            <Share2 size={16} color={theme.green} />
            <Text style={[styles.quickActionText, { color: theme.green }]}>Invite</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: theme.purpleMuted }]}
            onPress={() => router.push({ pathname: '/challenge-history' as never, params: { groupId: id } })}
          >
            <Clock size={16} color={theme.purple} />
            <Text style={[styles.quickActionText, { color: theme.purple }]}>History</Text>
          </TouchableOpacity>

          {!activeChallenge && (
            <TouchableOpacity
              style={[styles.quickAction, { backgroundColor: theme.coralMuted }]}
              onPress={handleRing}
            >
              <Zap size={16} color={theme.coral} />
              <Text style={[styles.quickActionText, { color: theme.coral }]}>Ring!</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {group.hasActiveChallenge && !hasSubmittedToday && (
        <View ref={challengeBarRef} collapsable={false}>
          <TouchableOpacity
            style={styles.challengeBar}
            onPress={handleSnapChallenge}
            activeOpacity={0.85}
            testID="snap-challenge-btn"
          >
            <View style={styles.challengeContent}>
              <Camera size={20} color={theme.white} />
              <View>
                <Text style={styles.challengeTitle}>
                  {activeChallenge?.type === 'snap' ? 'Snap Challenge Active!' : 'Challenge Active!'}
                </Text>
                <Text style={styles.challengeSubtitle}>Tap to respond</Text>
              </View>
            </View>
            <View style={styles.challengeTimer}>
              <Text style={styles.challengeTimerText}>{countdown}</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {hasSubmittedToday && (
        <View style={styles.submittedBanner}>
          <Text style={styles.submittedText}>You submitted today! Check out your crew's snaps.</Text>
        </View>
      )}

      <ScrollView
        style={styles.feed}
        contentContainerStyle={styles.feedContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={!isDemo && groupQuery.isRefetching}
            onRefresh={onRefresh}
            tintColor={theme.coral}
          />
        }
      >
        {!hasSubmittedToday && snaps.length > 0 && !isDemo && (
          <View style={styles.peekNotice}>
            <Text style={styles.peekNoticeText}>Submit your snap to see what everyone shared!</Text>
          </View>
        )}

        {snaps.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📸</Text>
            <Text style={styles.emptyTitle}>No snaps yet</Text>
            <Text style={styles.emptySubtext}>Be the first to share!</Text>
          </View>
        ) : (
          snaps.map(snap => (
            <SnapCard
              key={snap.id}
              snap={snap}
              isLocked={isDemo ? false : !hasSubmittedToday}
              onReact={handleReaction}
            />
          ))
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Tour Tooltip: Step 2 — Challenge bar */}
      <Tooltip
        visible={isDemo && tourStep === 'group_detail'}
        message="Your friends posted snaps — take yours!"
        targetLayout={challengeBarLayout}
        position="below"
        onNext={handleGroupDetailTourNext}
        onDismiss={completeTour}
        nextLabel="Got it"
        step={2}
        totalSteps={3}
      />

      {/* Ring Modal — Challenge Type Picker */}
      <Modal visible={showRingModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Start a Challenge</Text>
              <TouchableOpacity onPress={() => setShowRingModal(false)} style={styles.modalClose}>
                <X size={20} color={theme.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.challengeGrid}>
              {challengeTypes.map((ct) => (
                <TouchableOpacity
                  key={ct.type}
                  style={styles.challengeTypeBtn}
                  onPress={() => {
                    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    ringMutation.mutate(ct.type);
                  }}
                  disabled={ringMutation.isPending}
                  activeOpacity={0.8}
                >
                  <Text style={styles.challengeTypeEmoji}>{ct.emoji}</Text>
                  <Text style={styles.challengeTypeLabel}>{ct.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Group Menu Modal */}
      <Modal visible={showGroupMenu} transparent animationType="slide">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowGroupMenu(false)}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{group.name}</Text>
              <TouchableOpacity onPress={() => setShowGroupMenu(false)} style={styles.modalClose}>
                <X size={20} color={theme.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.menuList}>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowGroupMenu(false);
                  router.push({ pathname: '/invite-members' as never, params: { groupId: id } });
                }}
              >
                <UserPlus size={20} color={theme.text} />
                <Text style={styles.menuItemText}>Invite Members</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={handleShareGroup}>
                <Share2 size={20} color={theme.text} />
                <Text style={styles.menuItemText}>Share Group</Text>
              </TouchableOpacity>

              {isAdmin && (
                <>
                  <TouchableOpacity style={styles.menuItem} onPress={handleEditGroup}>
                    <Edit3 size={20} color={theme.text} />
                    <Text style={styles.menuItemText}>Edit Group</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.menuItem} onPress={handleDeleteGroup}>
                    <Trash2 size={20} color={theme.red} />
                    <Text style={[styles.menuItemText, { color: theme.red }]}>Delete Group</Text>
                  </TouchableOpacity>
                </>
              )}

              {!isAdmin && (
                <TouchableOpacity style={styles.menuItem} onPress={handleLeaveGroup}>
                  <LogOut size={20} color={theme.red} />
                  <Text style={[styles.menuItemText, { color: theme.red }]}>Leave Group</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  errorText: {
    fontSize: 16,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerEmoji: {
    fontSize: 22,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: theme.text,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupMeta: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 10,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  membersPreview: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: theme.bg,
  },
  memberCount: {
    fontSize: 13,
    color: theme.textSecondary,
    marginLeft: 10,
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 8,
    paddingVertical: 10,
  },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  challengeBar: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: theme.coral,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  challengeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  challengeTitle: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: theme.white,
  },
  challengeSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 1,
  },
  challengeTimer: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  challengeTimerText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: theme.white,
    fontVariant: ['tabular-nums'],
  },
  submittedBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: theme.greenMuted,
    borderRadius: 12,
    padding: 12,
  },
  submittedText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: theme.green,
    textAlign: 'center',
  },
  feed: {
    flex: 1,
  },
  feedContent: {
    paddingHorizontal: 20,
  },
  peekNotice: {
    backgroundColor: theme.yellowMuted,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  peekNoticeText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: theme.yellow,
    textAlign: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 8,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: theme.text,
  },
  emptySubtext: {
    fontSize: 14,
    color: theme.textMuted,
  },
  // Ring modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.bgCard,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: theme.text,
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
    gap: 12,
  },
  challengeTypeBtn: {
    width: '47%',
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  challengeTypeEmoji: {
    fontSize: 32,
  },
  challengeTypeLabel: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: theme.text,
  },
  // Group menu styles
  menuList: {
    gap: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: theme.text,
  },
});
