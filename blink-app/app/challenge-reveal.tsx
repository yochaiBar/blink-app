import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Share2, ArrowLeft, Users, MessageCircle } from 'lucide-react-native';

import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import { useApp } from '@/providers/AppProvider';
import AvatarRing from '@/components/ui/AvatarRing';
import GlassCard from '@/components/ui/GlassCard';
import EncryptedImage from '@/components/EncryptedImage';
import { ApiChallengeResponse } from '@/types/api';
import { useChallengeReveal } from '@/hooks/useChallenge';
import { resolvePhotoUri } from '@/hooks/usePhotoUri';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PHOTO_ASPECT = 4 / 5;
const CARD_WIDTH = SCREEN_WIDTH;
const CARD_IMAGE_HEIGHT = CARD_WIDTH * PHOTO_ASPECT;
const REVEAL_DELAY_MS = 1500;
const QUICK_REACTIONS = ['\u{1F602}', '\u{1F525}', '\u{1F480}', '\u{1F60D}', '\u{1F440}'];

// ─── Confetti particle ───────────────────────────────────────────────
interface ConfettiParticle {
  id: number;
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  scale: Animated.Value;
  color: string;
  size: number;
}

const CONFETTI_COLORS = [theme.coral, theme.yellow, theme.green, theme.blue, theme.pink, theme.purple];

function useConfetti(count: number) {
  const particles = useRef<ConfettiParticle[]>([]);

  const fire = useCallback(() => {
    const newParticles: ConfettiParticle[] = [];
    for (let i = 0; i < count; i++) {
      newParticles.push({
        id: i,
        x: new Animated.Value(SCREEN_WIDTH / 2),
        y: new Animated.Value(SCREEN_HEIGHT / 2),
        opacity: new Animated.Value(1),
        scale: new Animated.Value(0),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + Math.random() * 6,
      });
    }
    particles.current = newParticles;

    newParticles.forEach((p) => {
      const targetX = SCREEN_WIDTH / 2 + (Math.random() - 0.5) * SCREEN_WIDTH * 0.8;
      const targetY = SCREEN_HEIGHT / 2 - 100 - Math.random() * 300;
      const duration = 800 + Math.random() * 400;

      Animated.parallel([
        Animated.spring(p.scale, { toValue: 1, tension: 80, friction: 6, useNativeDriver: true }),
        Animated.timing(p.x, { toValue: targetX, duration, useNativeDriver: true }),
        Animated.timing(p.y, { toValue: targetY, duration, useNativeDriver: true }),
        Animated.timing(p.opacity, { toValue: 0, duration: duration + 200, useNativeDriver: true }),
      ]).start();
    });
  }, [count]);

  return { particles: particles.current, fire };
}

// ─── Animated Reaction Button ────────────────────────────────────────
interface AnimatedReactionBtnProps {
  emoji: string;
  isSelected: boolean;
  count: number;
  onPress: () => void;
}

function AnimatedReactionBtn({ emoji, isSelected, count, onPress }: AnimatedReactionBtnProps) {
  const bounceAnim = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    bounceAnim.setValue(1);
    Animated.sequence([
      Animated.spring(bounceAnim, {
        toValue: 1.3,
        tension: 300,
        friction: 6,
        useNativeDriver: true,
      }),
      Animated.spring(bounceAnim, {
        toValue: 1,
        tension: 200,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
    onPress();
  }, [bounceAnim, onPress]);

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
      <Animated.View
        style={[styles.quickReactBtn, isSelected && styles.reactionSelected, { transform: [{ scale: bounceAnim }] }]}
      >
        <Text style={styles.quickReactEmoji}>{emoji}</Text>
        {count > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{count}</Text>
          </View>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────
export default function ChallengeRevealScreen() {
  const { challengeId, groupId, localPhotoUri } = useLocalSearchParams<{
    challengeId: string;
    groupId: string;
    localPhotoUri?: string;
  }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, addReaction } = useApp();

  // Phase management
  const [phase, setPhase] = useState<'youreIn' | 'reveal' | 'summary'>('youreIn');
  const [revealedCount, setRevealedCount] = useState(0);
  const [autoRevealing, setAutoRevealing] = useState(true);
  const [hasScrolledManually, setHasScrolledManually] = useState(false);
  const [youreInTimerDone, setYoureInTimerDone] = useState(false);

  // Animations — Phase 1
  const checkScale = useRef(new Animated.Value(0)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;

  // Confetti
  const smallConfetti = useConfetti(10);
  const bigConfetti = useConfetti(16);

  // Summary fade
  const summaryOpacity = useRef(new Animated.Value(0)).current;
  const summarySlide = useRef(new Animated.Value(40)).current;

  // Card animations (max 20 cards)
  const cardAnims = useRef(
    Array.from({ length: 20 }, () => ({
      translateY: new Animated.Value(100),
      scale: new Animated.Value(0.8),
      opacity: new Animated.Value(0),
    })),
  ).current;

  // ScrollView ref
  const scrollRef = useRef<ScrollView>(null);

  // ── Selected reactions (local state for visual feedback) ───────
  const [selectedReactions, setSelectedReactions] = useState<Record<string, Set<string>>>({});

  // ── Data Fetching (the demo group is served by demoSource behind this hook) ──
  const { isSample, revealQuery, groupQuery, markSeen } = useChallengeReveal(challengeId, groupId, user);
  const { data: revealData, isLoading } = revealQuery;
  const { data: groupData } = groupQuery;

  // Sort responses: user's own first, then by responded_at
  const sortedResponses = useMemo(() => {
    if (!revealData?.responses) return [];
    const responses = [...revealData.responses];
    responses.sort((a, b) => {
      if (a.user_id === user.id) return -1;
      if (b.user_id === user.id) return 1;
      return new Date(a.responded_at).getTime() - new Date(b.responded_at).getTime();
    });
    return responses;
  }, [revealData?.responses, user.id]);

  const totalResponses = sortedResponses.length;
  const memberCount = groupData?.members?.length ?? totalResponses;
  const isLastResponder =
    totalResponses > 0 &&
    totalResponses >= memberCount &&
    sortedResponses[sortedResponses.length - 1]?.user_id === user.id;

  // Challenge info
  const challengePrompt = revealData?.challenge?.prompt ?? null;

  // Average response time
  const avgResponseTime = useMemo(() => {
    const times = sortedResponses.map((r) => r.response_time_ms).filter((t): t is number => t != null && t > 0);
    if (times.length === 0) return null;
    return (times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1);
  }, [sortedResponses]);

  // ── Phase 1: "You're In!" animation ─────────────────────────────
  useEffect(() => {
    if (phase !== 'youreIn') return;

    // Camera flash
    Animated.sequence([
      Animated.timing(flashOpacity, { toValue: 0.8, duration: 80, useNativeDriver: true }),
      Animated.timing(flashOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();

    // Checkmark entrance
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(checkOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(checkScale, { toValue: 1.2, tension: 60, friction: 6, useNativeDriver: true }),
      ]).start(() => {
        Animated.spring(checkScale, { toValue: 1, tension: 80, friction: 8, useNativeDriver: true }).start();
      });
    }, 200);

    // Title fade in
    setTimeout(() => {
      Animated.timing(titleOpacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }, 500);

    // Confetti
    setTimeout(() => {
      smallConfetti.fire();
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }, 400);

    // Mark timer as done after 2s (transition handled by separate effect)
    const timeout = setTimeout(() => {
      setYoureInTimerDone(true);
    }, 2000);

    return () => clearTimeout(timeout);
  }, [phase]);

  // ── Transition from youreIn to reveal when timer + data are ready ──
  useEffect(() => {
    if (youreInTimerDone && phase === 'youreIn' && revealData && !isLoading) {
      setPhase('reveal');
    }
  }, [youreInTimerDone, phase, revealData, isLoading]);

  // ── Phase 2: Sequential card reveal ─────────────────────────────
  useEffect(() => {
    if (phase !== 'reveal' || totalResponses === 0) return;
    if (!autoRevealing || hasScrolledManually) return;

    if (revealedCount >= totalResponses) {
      // All revealed — transition to summary
      setTimeout(() => {
        setPhase('summary');
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      }, 800);
      return;
    }

    const timeout = setTimeout(
      () => {
        revealNextCard(revealedCount);
      },
      revealedCount === 0 ? 300 : REVEAL_DELAY_MS,
    );

    return () => clearTimeout(timeout);
  }, [phase, revealedCount, totalResponses, autoRevealing, hasScrolledManually]);

  const revealNextCard = useCallback(
    (index: number) => {
      if (index >= totalResponses || index >= cardAnims.length) return;

      const anim = cardAnims[index];
      Animated.parallel([
        Animated.spring(anim.translateY, { toValue: 0, tension: 50, friction: 7, useNativeDriver: true }),
        Animated.spring(anim.scale, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
        Animated.timing(anim.opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();

      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      setRevealedCount(index + 1);
    },
    [totalResponses, cardAnims],
  );

  // Tap to skip wait
  const handleTapToAdvance = useCallback(() => {
    if (phase === 'youreIn') {
      // Mark timer as done; the transition effect will handle phase change when data is ready
      setYoureInTimerDone(true);
      return;
    }
    if (phase !== 'reveal') return;
    if (revealedCount < totalResponses) {
      revealNextCard(revealedCount);
    }
  }, [phase, revealedCount, totalResponses, revealNextCard]);

  // ── Phase 3: Summary animations ─────────────────────────────────
  useEffect(() => {
    if (phase !== 'summary') return;

    Animated.parallel([
      Animated.timing(summaryOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(summarySlide, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();

    markSeen();

    if (isLastResponder) {
      bigConfetti.fire();
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }
    }
  }, [phase, isLastResponder, markSeen]);

  // ── Scroll handler ──────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    if (!hasScrolledManually && phase === 'reveal') {
      setHasScrolledManually(true);
      setAutoRevealing(false);
      // Reveal all remaining cards immediately
      for (let i = revealedCount; i < totalResponses && i < cardAnims.length; i++) {
        const anim = cardAnims[i];
        anim.translateY.setValue(0);
        anim.scale.setValue(1);
        anim.opacity.setValue(1);
      }
      setRevealedCount(totalResponses);
    }
  }, [hasScrolledManually, phase, revealedCount, totalResponses, cardAnims]);

  // ── Initialize selected reactions from API data ─────────────────
  const initializedResponseIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!sortedResponses.length || !user.id) return;
    setSelectedReactions((prev) => {
      const next = { ...prev };
      for (const response of sortedResponses) {
        if (initializedResponseIds.current.has(response.id)) continue;
        initializedResponseIds.current.add(response.id);
        if (response.reactions) {
          const userEmojis = new Set<string>();
          for (const r of response.reactions) {
            if (r.user_ids?.includes(user.id)) {
              userEmojis.add(r.emoji);
            }
          }
          if (userEmojis.size > 0) {
            next[response.id] = userEmojis;
          }
        }
      }
      return next;
    });
  }, [sortedResponses, user.id]);

  // ── Helper to get reaction count for a specific emoji on a response ──
  const getReactionCount = useCallback((response: ApiChallengeResponse, emoji: string): number => {
    if (!response.reactions) return 0;
    const reaction = response.reactions.find((r) => r.emoji === emoji);
    return reaction?.count ?? 0;
  }, []);

  // ── Reaction handler ────────────────────────────────────────────
  const handleReact = useCallback(
    async (responseId: string, emoji: string) => {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      // Toggle local selected state
      setSelectedReactions((prev) => {
        const next = { ...prev };
        const current = new Set(prev[responseId] ?? []);
        if (current.has(emoji)) {
          current.delete(emoji);
        } else {
          current.add(emoji);
        }
        next[responseId] = current;
        return next;
      });

      await addReaction(responseId, emoji);
      queryClient.invalidateQueries({ queryKey: ['challenge-reveal', challengeId] });
    },
    [addReaction, challengeId, queryClient],
  );

  // ── Navigation ──────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    // Only your own photo leaves the app: others' photos were sent to the
    // group end-to-end, not to be re-shared elsewhere.
    const responseToShare = sortedResponses.find((r) => r.user_id === user.id);
    const photoUri = responseToShare ? ((await resolvePhotoUri(responseToShare.id)) ?? localPhotoUri) : null;

    if (!responseToShare || !photoUri) {
      Alert.alert('No Photo', 'You can share your own photo once you have answered this challenge.');
      return;
    }

    const responseTimeSec =
      responseToShare.response_time_ms != null && responseToShare.response_time_ms > 0
        ? (responseToShare.response_time_ms / 1000).toFixed(1)
        : undefined;

    router.push({
      pathname: '/share-card',
      params: {
        photoUri,
        prompt: challengePrompt ?? 'Blink Challenge',
        userName: responseToShare.display_name ?? 'User',
        groupName: groupData?.name ?? 'Group',
        groupEmoji: groupData?.icon ?? '',
        ...(responseTimeSec != null ? { responseTimeSec } : {}),
      },
    });
  }, [sortedResponses, user.id, challengePrompt, groupData, router, localPhotoUri]);

  const handleBackToFeed = useCallback(() => {
    router.dismiss();
  }, [router]);

  // ── Format response time ────────────────────────────────────────
  const formatTime = (ms: number | null): string => {
    if (!ms || ms <= 0) return '';
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // ── Render helpers ──────────────────────────────────────────────

  // Progress dots
  const renderProgressDots = () => {
    if (totalResponses <= 1) return null;
    return (
      <View style={styles.progressDots}>
        {sortedResponses.map((_, i) => (
          <View key={i} style={[styles.dot, i < revealedCount ? styles.dotActive : styles.dotInactive]} />
        ))}
      </View>
    );
  };

  // Photo response card
  const renderPhotoCard = (response: ApiChallengeResponse, index: number) => {
    const isOwnResponse = response.user_id === user.id;
    const anim = cardAnims[index];
    const responseTime = formatTime(response.response_time_ms);

    return (
      <Animated.View
        key={response.id}
        style={[
          styles.revealCard,
          {
            transform: [{ translateY: anim.translateY }, { scale: anim.scale }],
            opacity: anim.opacity,
          },
        ]}
      >
        <View style={styles.photoContainer}>
          {/* Photo from the local store; your own snap falls back to the file you just took */}
          {response.has_photo || (isOwnResponse && localPhotoUri) ? (
            <EncryptedImage
              responseId={response.id}
              fallbackUri={isOwnResponse ? localPhotoUri : undefined}
              style={styles.photo}
              contentFit="cover"
              transition={300}
              cachePolicy="none"
              // Open challenge you haven't answered: others' photos stay
              // blurred until you do (the server doesn't gate them).
              blurRadius={revealData?.blurOthers && !isOwnResponse ? 40 : undefined}
            />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoPlaceholderEmoji}>{'\u{1F4F8}'}</Text>
            </View>
          )}

          {/* Top gradient overlay with user info */}
          <LinearGradient
            colors={['rgba(0,0,0,0.7)', 'transparent']}
            style={styles.topOverlay}
            pointerEvents="box-none"
          >
            <View style={styles.userInfoRow}>
              <AvatarRing name={response.display_name ?? undefined} size={32} />
              <View style={styles.userInfoText}>
                <View style={styles.nameRow}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {response.display_name ?? 'User'}
                  </Text>
                  {isOwnResponse && (
                    <View style={styles.youBadge}>
                      <Text style={styles.youBadgeText}>You</Text>
                    </View>
                  )}
                </View>
                {responseTime !== '' && <Text style={styles.responseTime}>{responseTime}</Text>}
              </View>
            </View>
          </LinearGradient>

          {/* Bottom gradient overlay with reactions */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.6)']}
            style={styles.bottomOverlay}
            pointerEvents="box-none"
          >
            <View style={styles.quickReactions}>
              {QUICK_REACTIONS.map((emoji) => (
                <AnimatedReactionBtn
                  key={emoji}
                  emoji={emoji}
                  isSelected={selectedReactions[response.id]?.has(emoji) ?? false}
                  count={getReactionCount(response, emoji)}
                  onPress={() => handleReact(response.id, emoji)}
                />
              ))}
              {!isSample ? (
                <TouchableOpacity
                  style={styles.quickReactBtn}
                  onPress={() =>
                    router.push({ pathname: '/comments/[responseId]', params: { responseId: response.id } })
                  }
                  testID={`reveal-comments-${response.id}`}
                >
                  <MessageCircle size={18} color={theme.white} />
                  {response.comment_count ? <Text style={styles.commentCount}>{response.comment_count}</Text> : null}
                </TouchableOpacity>
              ) : null}
            </View>
          </LinearGradient>
        </View>
      </Animated.View>
    );
  };

  // ── RENDER ──────────────────────────────────────────────────────

  // Phase 1: "You're In!"
  if (phase === 'youreIn') {
    return (
      <TouchableOpacity
        style={[styles.fullScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
        activeOpacity={1}
        onPress={handleTapToAdvance}
      >
        <View style={styles.youreInContainer}>
          {/* Camera flash */}
          <Animated.View style={[styles.flash, { opacity: flashOpacity }]} pointerEvents="none" />

          {/* Checkmark */}
          <Animated.View
            style={[
              styles.checkCircle,
              {
                transform: [{ scale: checkScale }],
                opacity: checkOpacity,
              },
            ]}
          >
            <Check size={48} color={theme.white} strokeWidth={3} />
          </Animated.View>

          {/* Title */}
          <Animated.Text style={[styles.youreInTitle, { opacity: titleOpacity }]}>Your blink is in!</Animated.Text>

          <Animated.Text style={[styles.youreInSubtitle, { opacity: titleOpacity }]}>
            Tap to see what your friends posted
          </Animated.Text>

          {youreInTimerDone && isLoading && <Text style={styles.youreInLoading}>Loading...</Text>}

          {/* Confetti particles */}
          {smallConfetti.particles.map((p) => (
            <Animated.View
              key={`confetti-${p.id}`}
              style={[
                styles.confettiParticle,
                {
                  width: p.size,
                  height: p.size,
                  borderRadius: p.size / 2,
                  backgroundColor: p.color,
                  transform: [
                    { translateX: Animated.subtract(p.x, SCREEN_WIDTH / 2) },
                    { translateY: Animated.subtract(p.y, SCREEN_HEIGHT / 2) },
                    { scale: p.scale },
                  ],
                  opacity: p.opacity,
                },
              ]}
              pointerEvents="none"
            />
          ))}
        </View>
      </TouchableOpacity>
    );
  }

  // Phase 2 & 3: Reveal + Summary
  return (
    <View style={[styles.fullScreen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBackToFeed}>
          <ArrowLeft size={20} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          {groupData && (
            <Text style={styles.headerGroupName}>
              {groupData.icon} {groupData.name}
            </Text>
          )}
          {challengePrompt && (
            <Text style={styles.headerPrompt} numberOfLines={1}>
              {challengePrompt}
            </Text>
          )}
        </View>

        <View style={styles.headerRight} />
      </View>

      {/* Progress dots */}
      {renderProgressDots()}

      {/* Scrollable card area */}
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={handleScroll}
      >
        <View>
          {/* Tap-to-advance overlay: only active during reveal phase while cards remain */}
          {phase === 'reveal' && revealedCount < totalResponses && (
            <TouchableOpacity
              activeOpacity={1}
              onPress={handleTapToAdvance}
              style={StyleSheet.absoluteFill}
              // Render above cards so it captures taps to advance
              // Once all cards are revealed this overlay is removed, exposing reaction buttons
            />
          )}
          {/* Response cards */}
          {sortedResponses.map((response, index) => renderPhotoCard(response, index))}

          {/* Loading placeholder */}
          {isLoading && (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Loading responses...</Text>
            </View>
          )}
        </View>

        {/* Phase 3: Summary */}
        {phase === 'summary' && (
          <Animated.View
            style={[
              styles.summaryContainer,
              {
                opacity: summaryOpacity,
                transform: [{ translateY: summarySlide }],
              },
            ]}
          >
            {/* Stats row */}
            <GlassCard style={styles.statsCard} padding={16} borderRadius={16}>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>
                    {totalResponses}/{memberCount}
                  </Text>
                  <Text style={styles.statLabel}>responded</Text>
                </View>
                {avgResponseTime && (
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{avgResponseTime}s</Text>
                    <Text style={styles.statLabel}>avg time</Text>
                  </View>
                )}
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{'\u{1F525}'}</Text>
                  <Text style={styles.statLabel}>top reaction</Text>
                </View>
              </View>
            </GlassCard>

            {/* Last responder celebration */}
            {isLastResponder && (
              <View style={styles.celebrationContainer}>
                <Text style={styles.celebrationEmoji}>{'\u{1F389}'}</Text>
                <Text style={styles.celebrationText}>You completed the group!</Text>
              </View>
            )}

            {/* Action buttons: the demo reveal ends the tour with a nudge to a real group */}
            {isSample ? (
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={styles.shareBtn}
                  onPress={() => router.replace('/create-group' as never)}
                  activeOpacity={0.85}
                >
                  <Users size={18} color={theme.white} />
                  <Text style={styles.shareBtnText}>Create your first group</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.feedBtn}
                  onPress={() => router.replace('/join-group' as never)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.feedBtnText}>Join a group</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.actionButtons}>
                <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.85}>
                  <Share2 size={18} color={theme.white} />
                  <Text style={styles.shareBtnText}>Share This Blink</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.feedBtn} onPress={handleBackToFeed} activeOpacity={0.7}>
                  <Text style={styles.feedBtnText}>Back to Feed</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Big confetti for last responder */}
            {bigConfetti.particles.map((p) => (
              <Animated.View
                key={`big-confetti-${p.id}`}
                style={[
                  styles.confettiParticle,
                  {
                    width: p.size,
                    height: p.size,
                    borderRadius: p.size / 2,
                    backgroundColor: p.color,
                    transform: [
                      { translateX: Animated.subtract(p.x, SCREEN_WIDTH / 2) },
                      { translateY: Animated.subtract(p.y, SCREEN_HEIGHT / 2) },
                      { scale: p.scale },
                    ],
                    opacity: p.opacity,
                  },
                ]}
                pointerEvents="none"
              />
            ))}
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────
const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: theme.bg,
  },

  // ── Phase 1: You're In ──
  youreInContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.white,
  },
  checkCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.green,
    justifyContent: 'center',
    alignItems: 'center',
  },
  youreInTitle: {
    ...typography.displayMedium,
    color: theme.text,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  youreInSubtitle: {
    ...typography.body,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  youreInLoading: {
    ...typography.caption,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  confettiParticle: {
    position: 'absolute',
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  headerGroupName: {
    ...typography.headlineMedium,
    color: theme.text,
    textAlign: 'center',
  },
  headerPrompt: {
    ...typography.caption,
    color: theme.textSecondary,
    textAlign: 'center',
  },
  headerRight: {
    width: 36,
  },

  // ── Progress dots ──
  progressDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: theme.coral,
  },
  dotInactive: {
    backgroundColor: theme.border,
  },

  // ── Scroll ──
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    gap: spacing.lg,
  },

  // ── Photo card ──
  revealCard: {
    width: CARD_WIDTH,
  },
  photoContainer: {
    width: CARD_WIDTH,
    height: CARD_IMAGE_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPlaceholderEmoji: {
    fontSize: 48,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    alignItems: 'center',
  },
  userInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  userInfoText: {
    flex: 1,
    gap: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  userName: {
    ...typography.bodyBold,
    color: theme.white,
  },
  youBadge: {
    backgroundColor: theme.coral,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  youBadgeText: {
    ...typography.labelSmall,
    color: theme.white,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  responseTime: {
    ...typography.small,
    color: 'rgba(255,255,255,0.7)',
  },

  // ── Reactions ──
  quickReactions: {
    flexDirection: 'row',
    gap: 8,
  },
  commentCount: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: theme.coral,
    color: theme.white,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  quickReactBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickReactEmoji: {
    fontSize: 18,
  },
  reactionSelected: {
    borderWidth: 2,
    borderColor: theme.coral,
  },
  countBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: theme.white,
    textAlign: 'center',
  },

  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  loadingText: {
    ...typography.body,
    color: theme.textMuted,
  },

  // ── Summary ──
  summaryContainer: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  statsCard: {
    marginBottom: 0,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statItem: {
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    ...typography.statMedium,
    color: theme.text,
  },
  statLabel: {
    ...typography.caption,
    color: theme.textMuted,
  },
  celebrationContainer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  celebrationEmoji: {
    fontSize: 48,
  },
  celebrationText: {
    ...typography.headlineLarge,
    color: theme.yellow,
    textAlign: 'center',
  },
  actionButtons: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: theme.coral,
    paddingVertical: 16,
    borderRadius: borderRadius.lg,
  },
  shareBtnText: {
    ...typography.bodyBold,
    color: theme.white,
    fontWeight: '800',
  },
  feedBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  feedBtnText: {
    ...typography.bodyBold,
    color: theme.textSecondary,
  },
});
