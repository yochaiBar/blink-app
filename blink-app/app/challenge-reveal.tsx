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
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Share2, ArrowLeft } from 'lucide-react-native';

import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import { api, addReactionApi, removeReactionApi } from '@/services/api';
import { useApp } from '@/providers/AppProvider';
import AvatarRing from '@/components/ui/AvatarRing';
import GlassCard from '@/components/ui/GlassCard';
import AiCommentaryCard from '@/components/AiCommentaryCard';
import { ApiChallengeResponse, ApiChallenge, ApiGroupDetail } from '@/types/api';

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

// ─── Types ───────────────────────────────────────────────────────────
interface RevealData {
  responses: ApiChallengeResponse[];
  aiCommentary: string | null;
  challenge: ApiChallenge | null;
}

// ─── Main Screen ─────────────────────────────────────────────────────
export default function ChallengeRevealScreen() {
  const { challengeId, groupId } = useLocalSearchParams<{ challengeId: string; groupId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, addReaction } = useApp();

  // Phase management
  const [phase, setPhase] = useState<'youreIn' | 'reveal' | 'summary'>('youreIn');
  const [revealedCount, setRevealedCount] = useState(0);
  const [autoRevealing, setAutoRevealing] = useState(true);
  const [hasScrolledManually, setHasScrolledManually] = useState(false);

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

  // ── Data Fetching ────────────────────────────────────────────────
  const { data: revealData, isLoading } = useQuery<RevealData>({
    queryKey: ['challenge-reveal', challengeId],
    queryFn: async (): Promise<RevealData> => {
      // Try reveal endpoint first
      try {
        const res = await api(`/challenges/${challengeId}/reveal`);
        return {
          responses: res.responses ?? [],
          aiCommentary: res.aiCommentary ?? res.ai_commentary ?? null,
          challenge: res.challenge ?? null,
        };
      } catch {
        // Fallback: fetch responses directly
        const responses: ApiChallengeResponse[] = await api(
          `/challenges/${challengeId}/responses`,
        );
        return { responses: Array.isArray(responses) ? responses : [], aiCommentary: null, challenge: null };
      }
    },
    enabled: !!challengeId,
    staleTime: 60_000,
  });

  const { data: groupData } = useQuery<ApiGroupDetail>({
    queryKey: ['group-detail-reveal', groupId],
    queryFn: () => api(`/groups/${groupId}`),
    enabled: !!groupId,
    staleTime: 60_000,
  });

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
  const challengePrompt =
    revealData?.challenge?.prompt_text ??
    revealData?.challenge?.prompt ??
    null;
  const challengeType = revealData?.challenge?.type ?? 'snap';
  const challengeOptions = revealData?.challenge?.options_json ?? revealData?.challenge?.options ?? null;

  // Average response time
  const avgResponseTime = useMemo(() => {
    const times = sortedResponses
      .map((r) => r.response_time_ms)
      .filter((t): t is number => t != null && t > 0);
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

    // Auto-transition to Phase 2
    const timeout = setTimeout(() => {
      setPhase('reveal');
    }, 2000);

    return () => clearTimeout(timeout);
  }, [phase]);

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

    const timeout = setTimeout(() => {
      revealNextCard(revealedCount);
    }, revealedCount === 0 ? 300 : REVEAL_DELAY_MS);

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
      setPhase('reveal');
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

    if (isLastResponder) {
      bigConfetti.fire();
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }
    }
  }, [phase, isLastResponder]);

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

  // ── Reaction handler ────────────────────────────────────────────
  const handleReact = useCallback(
    async (responseId: string, emoji: string) => {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      await addReaction(responseId, emoji);
      queryClient.invalidateQueries({ queryKey: ['challenge-reveal', challengeId] });
    },
    [addReaction, challengeId, queryClient],
  );

  // ── Navigation ──────────────────────────────────────────────────
  const handleShare = useCallback(() => {
    // Find the user's own response to share
    const ownResponse = sortedResponses.find((r) => r.user_id === user.id);
    const responseToShare = ownResponse ?? sortedResponses[0];

    if (!responseToShare?.photo_url) {
      Alert.alert('No Photo', 'There is no photo to share for this challenge.');
      return;
    }

    const responseTimeSec =
      responseToShare.response_time_ms != null && responseToShare.response_time_ms > 0
        ? (responseToShare.response_time_ms / 1000).toFixed(1)
        : undefined;

    router.push({
      pathname: '/share-card',
      params: {
        photoUri: responseToShare.photo_url,
        prompt: challengePrompt ?? 'Blink Challenge',
        userName: responseToShare.display_name ?? 'User',
        userAvatar: responseToShare.avatar_url ?? '',
        groupName: groupData?.name ?? 'Group',
        groupEmoji: groupData?.icon ?? '',
        ...(responseTimeSec != null ? { responseTimeSec } : {}),
      },
    });
  }, [sortedResponses, user.id, challengePrompt, groupData, router]);

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
          <View
            key={i}
            style={[
              styles.dot,
              i < revealedCount ? styles.dotActive : styles.dotInactive,
            ]}
          />
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
            transform: [
              { translateY: anim.translateY },
              { scale: anim.scale },
            ],
            opacity: anim.opacity,
          },
        ]}
      >
        <View style={styles.photoContainer}>
          {/* Photo */}
          {response.photo_url ? (
            <Image
              source={{ uri: response.photo_url }}
              style={styles.photo}
              contentFit="cover"
              transition={300}
            />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoPlaceholderEmoji}>
                {'\u{1F4F8}'}
              </Text>
            </View>
          )}

          {/* Top gradient overlay with user info */}
          <LinearGradient
            colors={['rgba(0,0,0,0.7)', 'transparent']}
            style={styles.topOverlay}
            pointerEvents="box-none"
          >
            <View style={styles.userInfoRow}>
              <AvatarRing
                uri={response.avatar_url}
                name={response.display_name ?? undefined}
                size={32}
              />
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
                {responseTime !== '' && (
                  <Text style={styles.responseTime}>{responseTime}</Text>
                )}
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
                <TouchableOpacity
                  key={emoji}
                  style={styles.quickReactBtn}
                  onPress={() => handleReact(response.id, emoji)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.quickReactEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </LinearGradient>
        </View>
      </Animated.View>
    );
  };

  // Quiz response card
  const renderQuizCard = (response: ApiChallengeResponse, index: number) => {
    const isOwnResponse = response.user_id === user.id;
    const anim = cardAnims[index];
    const responseTime = formatTime(response.response_time_ms);
    const answerText =
      response.answer_text ??
      (response.answer_index != null && challengeOptions
        ? challengeOptions[response.answer_index]
        : null) ??
      'No answer';

    // Tally votes per option
    const voteCounts: Record<number, number> = {};
    if (challengeOptions) {
      sortedResponses.forEach((r) => {
        if (r.answer_index != null) {
          voteCounts[r.answer_index] = (voteCounts[r.answer_index] ?? 0) + 1;
        }
      });
    }

    return (
      <Animated.View
        key={response.id}
        style={[
          styles.quizCardWrapper,
          {
            transform: [
              { translateY: anim.translateY },
              { scale: anim.scale },
            ],
            opacity: anim.opacity,
          },
        ]}
      >
        <GlassCard style={styles.quizCard} padding={16} borderRadius={16}>
          {/* User header */}
          <View style={styles.quizUserRow}>
            <AvatarRing
              uri={response.avatar_url}
              name={response.display_name ?? undefined}
              size={32}
            />
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
              {responseTime !== '' && (
                <Text style={styles.responseTime}>{responseTime}</Text>
              )}
            </View>
          </View>

          {/* Answer */}
          <View style={styles.quizAnswer}>
            <Text style={styles.quizAnswerText}>{answerText}</Text>
          </View>

          {/* Aggregated results (if options available) */}
          {challengeOptions && challengeOptions.length > 0 && (
            <View style={styles.quizResults}>
              {challengeOptions.map((option, optIdx) => {
                const count = voteCounts[optIdx] ?? 0;
                const pct = totalResponses > 0 ? (count / totalResponses) * 100 : 0;
                const isSelected = response.answer_index === optIdx;
                return (
                  <View key={optIdx} style={styles.quizOptionRow}>
                    <View
                      style={[
                        styles.quizOptionBar,
                        { width: `${Math.max(pct, 4)}%` as `${number}%` },
                        isSelected && styles.quizOptionBarSelected,
                      ]}
                    />
                    <Text
                      style={[
                        styles.quizOptionLabel,
                        isSelected && styles.quizOptionLabelSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {option}
                    </Text>
                    <Text style={styles.quizOptionPct}>
                      {Math.round(pct)}%
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Reactions */}
          <View style={styles.quizReactions}>
            {QUICK_REACTIONS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={styles.quizReactBtn}
                onPress={() => handleReact(response.id, emoji)}
                activeOpacity={0.7}
              >
                <Text style={styles.quickReactEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </GlassCard>
      </Animated.View>
    );
  };

  const renderCard = (response: ApiChallengeResponse, index: number) => {
    const isQuiz = challengeType !== 'snap' && challengeType !== 'prompt' && !response.photo_url;
    if (isQuiz) return renderQuizCard(response, index);
    return renderPhotoCard(response, index);
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
          <Animated.View
            style={[styles.flash, { opacity: flashOpacity }]}
            pointerEvents="none"
          />

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
          <Animated.Text style={[styles.youreInTitle, { opacity: titleOpacity }]}>
            Your blink is in!
          </Animated.Text>

          <Animated.Text style={[styles.youreInSubtitle, { opacity: titleOpacity }]}>
            Tap to see what your friends posted
          </Animated.Text>

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
        <TouchableOpacity activeOpacity={1} onPress={handleTapToAdvance}>
          {/* Response cards */}
          {sortedResponses.map((response, index) => renderCard(response, index))}

          {/* Loading placeholder */}
          {isLoading && (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Loading responses...</Text>
            </View>
          )}
        </TouchableOpacity>

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
            {/* AI Commentary */}
            {revealData?.aiCommentary && (
              <View style={styles.aiCommentaryWrapper}>
                <AiCommentaryCard commentary={revealData.aiCommentary} />
              </View>
            )}

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
                <Text style={styles.celebrationText}>
                  You completed the group!
                </Text>
              </View>
            )}

            {/* Action buttons */}
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={handleShare}
                activeOpacity={0.85}
              >
                <Share2 size={18} color={theme.white} />
                <Text style={styles.shareBtnText}>Share This Blink</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.feedBtn}
                onPress={handleBackToFeed}
                activeOpacity={0.7}
              >
                <Text style={styles.feedBtnText}>Back to Feed</Text>
              </TouchableOpacity>
            </View>

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

  // ── Quiz card ──
  quizCardWrapper: {
    paddingHorizontal: spacing.lg,
  },
  quizCard: {
    marginBottom: 0,
  },
  quizUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  quizAnswer: {
    backgroundColor: theme.coralMuted,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  quizAnswerText: {
    ...typography.bodyBold,
    color: theme.coral,
    textAlign: 'center',
  },
  quizResults: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  quizOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    backgroundColor: theme.surface,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  quizOptionBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.border,
    borderRadius: borderRadius.sm,
  },
  quizOptionBarSelected: {
    backgroundColor: theme.coralMuted,
  },
  quizOptionLabel: {
    ...typography.bodyMedium,
    color: theme.textSecondary,
    flex: 1,
    paddingHorizontal: spacing.sm,
    zIndex: 1,
  },
  quizOptionLabelSelected: {
    color: theme.coral,
    fontWeight: '600',
  },
  quizOptionPct: {
    ...typography.labelSmall,
    color: theme.textMuted,
    paddingHorizontal: spacing.sm,
    zIndex: 1,
  },
  quizReactions: {
    flexDirection: 'row',
    gap: 6,
  },
  quizReactBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Loading ──
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
  aiCommentaryWrapper: {
    marginBottom: 0,
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
