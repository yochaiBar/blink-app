import React, { useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Lock, Zap, Star, Sparkles } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import GlassCard from '@/components/ui/GlassCard';
import AvatarRing from '@/components/ui/AvatarRing';

// ── Types ──

export type FeedItemType =
  | 'photo'
  | 'locked_photo'
  | 'quiz_result'
  | 'ai_commentary'
  | 'spotlight'
  | 'active_challenge';

export interface FeedItemData {
  id: string;
  type: FeedItemType;
  // Photo items
  userName?: string;
  userAvatar?: string;
  groupName?: string;
  groupEmoji?: string;
  groupId?: string;
  challengeId?: string;
  photoUrl?: string;
  challengePrompt?: string;
  timeAgo?: string;
  reactions?: Array<{ emoji: string; count: number }>;
  // Quiz items
  quizQuestion?: string;
  quizResults?: Array<{ name: string; votes: number }>;
  // AI commentary
  commentary?: string;
  // Spotlight
  spotlightUser?: string;
  superlative?: string;
  funFact?: string;
  // Active challenge (blurred preview)
  blurredPhotoUrl?: string;
  responseCount?: number;
  memberCount?: number;
  challengeType?: string;
  // Sortable timestamp (ISO string)
  timestamp?: string;
  // Callbacks passed through
  onPress?: () => void;
  onRespond?: () => void;
  onReact?: (emoji: string) => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PHOTO_ASPECT_RATIO = 4 / 5;
const QUICK_REACTIONS = ['\uD83D\uDD25', '\uD83D\uDC80', '\uD83D\uDE0D', '\uD83D\uDE02', '\uD83D\uDC40'];

// ── Photo Feed Item ──

function PhotoFeedItem({ item }: { item: FeedItemData }) {
  const handleReact = useCallback(
    (emoji: string) => {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      item.onReact?.(emoji);
    },
    [item.onReact],
  );

  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    item.onPress?.();
  }, [item.onPress]);

  return (
    <TouchableOpacity activeOpacity={0.95} onPress={handlePress}>
      <View style={styles.photoItem}>
        {/* Header row */}
        <View style={styles.headerRow}>
          <AvatarRing
            uri={item.userAvatar}
            name={item.userName}
            size={32}
            ringColor={theme.coral}
            showStatus
            hasResponded
          />
          <View style={styles.headerText}>
            <View style={styles.headerNameRow}>
              <Text style={styles.userName} numberOfLines={1}>
                {item.userName}
              </Text>
              <Text style={styles.dot}>{'\u00B7'}</Text>
              <Text style={styles.groupName} numberOfLines={1}>
                {item.groupEmoji} {item.groupName}
              </Text>
              <Text style={styles.dot}>{'\u00B7'}</Text>
              <Text style={styles.timeAgo}>{item.timeAgo}</Text>
            </View>
          </View>
        </View>

        {/* Full-width photo */}
        <View style={styles.photoContainer}>
          <Image
            source={{ uri: item.photoUrl }}
            style={styles.photo}
            contentFit="cover"
            transition={200}
            recyclingKey={item.id}
          />
        </View>

        {/* Challenge prompt */}
        {item.challengePrompt ? (
          <Text style={styles.challengePrompt} numberOfLines={2}>
            {item.challengePrompt}
          </Text>
        ) : null}

        {/* Reactions bar */}
        <View style={styles.reactionsContainer}>
          {/* Existing reactions */}
          {item.reactions && item.reactions.length > 0 ? (
            <View style={styles.existingReactions}>
              {item.reactions.map((r, i) => (
                <TouchableOpacity
                  key={`${r.emoji}-${i}`}
                  style={styles.reactionPill}
                  onPress={() => handleReact(r.emoji)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                  <Text style={styles.reactionCount}>{r.count}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.quickReactRow}>
              {QUICK_REACTIONS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  style={styles.quickReactBtn}
                  onPress={() => handleReact(emoji)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.quickReactEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Locked Photo Feed Item ──

function LockedPhotoFeedItem({ item }: { item: FeedItemData }) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 2500,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 2500,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);

  const frostedOpacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 0.8],
  });

  const handleRespond = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    item.onRespond?.();
  }, [item.onRespond]);

  return (
    <View style={styles.photoItem}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <AvatarRing
          uri={item.userAvatar}
          name={item.userName}
          size={32}
          ringColor={theme.border}
          showStatus
          hasResponded={false}
        />
        <View style={styles.headerText}>
          <View style={styles.headerNameRow}>
            <Text style={styles.userName} numberOfLines={1}>
              {item.userName}
            </Text>
            <Text style={styles.dot}>{'\u00B7'}</Text>
            <Text style={styles.groupName} numberOfLines={1}>
              {item.groupEmoji} {item.groupName}
            </Text>
            <Text style={styles.dot}>{'\u00B7'}</Text>
            <Text style={styles.timeAgo}>{item.timeAgo}</Text>
          </View>
        </View>
      </View>

      {/* Blurred photo placeholder */}
      <View style={styles.lockedPhotoContainer}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: frostedOpacity }]}
        >
          <LinearGradient
            colors={[
              theme.bgElevated,
              theme.surface,
              theme.bgElevated,
              theme.surface,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* Frosted overlay pattern */}
        <LinearGradient
          colors={[
            'rgba(255, 107, 74, 0.06)',
            'rgba(167, 139, 250, 0.04)',
            'rgba(255, 107, 74, 0.08)',
          ]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.lockedCenter}>
          <View style={styles.lockIconCircle}>
            <Lock size={28} color={theme.textMuted} />
          </View>
          <Text style={styles.lockedTitle}>Respond to see this blink</Text>

          <TouchableOpacity
            style={styles.respondPill}
            onPress={handleRespond}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={[theme.coral, theme.coralDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.respondPillGradient}
            >
              <Zap size={16} color={theme.white} fill={theme.white} />
              <Text style={styles.respondPillText}>Respond now</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Quiz Result Feed Item ──

function QuizResultFeedItem({ item }: { item: FeedItemData }) {
  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    item.onPress?.();
  }, [item.onPress]);

  const maxVotes = Math.max(
    ...(item.quizResults?.map((r) => r.votes) ?? [1]),
  );

  return (
    <TouchableOpacity activeOpacity={0.95} onPress={handlePress}>
      <View style={styles.quizItem}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.quizIconCircle}>
            <Text style={styles.quizIconEmoji}>{item.groupEmoji || '\uD83E\uDDE0'}</Text>
          </View>
          <View style={styles.headerText}>
            <View style={styles.headerNameRow}>
              <Text style={styles.groupName} numberOfLines={1}>
                {item.groupName}
              </Text>
              <Text style={styles.dot}>{'\u00B7'}</Text>
              <Text style={styles.quizLabel}>Quiz</Text>
              <Text style={styles.dot}>{'\u00B7'}</Text>
              <Text style={styles.timeAgo}>{item.timeAgo}</Text>
            </View>
          </View>
        </View>

        {/* Quiz card */}
        <GlassCard
          style={styles.quizCard}
          padding={spacing.lg}
          borderRadius={borderRadius.lg}
        >
          <Text style={styles.quizQuestion}>{item.quizQuestion}</Text>
          <View style={styles.quizResultsList}>
            {item.quizResults?.map((result, i) => {
              const barWidth =
                maxVotes > 0
                  ? Math.max(10, (result.votes / maxVotes) * 100)
                  : 10;
              const isWinner = result.votes === maxVotes && maxVotes > 0;
              return (
                <View key={`${result.name}-${i}`} style={styles.quizResultRow}>
                  <View style={styles.quizResultInfo}>
                    <Text
                      style={[
                        styles.quizResultName,
                        isWinner && styles.quizResultNameWinner,
                      ]}
                    >
                      {result.name}
                    </Text>
                    <Text style={styles.quizResultVotes}>
                      {result.votes} vote{result.votes !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <View style={styles.quizBarTrack}>
                    <View
                      style={[
                        styles.quizBarFill,
                        {
                          width: `${barWidth}%`,
                          backgroundColor: isWinner
                            ? theme.coral
                            : theme.surfaceLight,
                        },
                      ]}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </GlassCard>
      </View>
    </TouchableOpacity>
  );
}

// ── AI Commentary Feed Item ──

function AICommentaryFeedItem({ item }: { item: FeedItemData }) {
  return (
    <View style={styles.aiItem}>
      <GlassCard
        style={styles.aiCard}
        padding={spacing.lg}
        borderRadius={borderRadius.lg}
        noBorder
      >
        <View style={styles.aiHeader}>
          <Sparkles size={16} color={theme.purple} />
          <Text style={styles.aiHeaderText}>
            Blink AI on "{item.groupName}"
          </Text>
        </View>
        <Text style={styles.aiCommentary}>{item.commentary}</Text>
      </GlassCard>
    </View>
  );
}

// ── Spotlight Feed Item ──

function SpotlightFeedItem({ item }: { item: FeedItemData }) {
  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    item.onPress?.();
  }, [item.onPress]);

  return (
    <TouchableOpacity activeOpacity={0.95} onPress={handlePress}>
      <View style={styles.spotlightItem}>
        <GlassCard
          style={styles.spotlightCard}
          padding={0}
          borderRadius={borderRadius.lg}
        >
          <LinearGradient
            colors={[
              'rgba(255, 216, 77, 0.08)',
              'rgba(255, 107, 74, 0.04)',
              'transparent',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.spotlightInner}>
            <View style={styles.spotlightHeader}>
              <Star size={16} color={theme.yellow} fill={theme.yellow} />
              <Text style={styles.spotlightLabel}>
                Daily Spotlight {'\u00B7'} {item.groupName}
              </Text>
            </View>
            <Text style={styles.spotlightUser}>
              {item.spotlightUser}
            </Text>
            <Text style={styles.spotlightSuperlative}>
              "{item.superlative}"
            </Text>
            {item.funFact ? (
              <Text style={styles.spotlightFact}>{item.funFact}</Text>
            ) : null}
          </View>
        </GlassCard>
      </View>
    </TouchableOpacity>
  );
}

// ── Active Challenge Feed Item (blurred preview) ──

function ActiveChallengeFeedItem({ item }: { item: FeedItemData }) {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const overlayOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 0.85],
  });

  const handleRespond = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    item.onRespond?.();
  }, [item.onRespond]);

  const hasPhoto = !!item.blurredPhotoUrl;
  const respondedText =
    item.responseCount && item.memberCount
      ? `${item.responseCount}/${item.memberCount} responded`
      : item.responseCount
        ? `${item.responseCount} responded`
        : '';

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={handleRespond}>
      <View style={styles.photoItem}>
        {/* Header row */}
        <View style={styles.headerRow}>
          <View style={styles.activeChallengeIconCircle}>
            <Text style={styles.quizIconEmoji}>{item.groupEmoji || '\u26A1'}</Text>
          </View>
          <View style={styles.headerText}>
            <View style={styles.headerNameRow}>
              <Text style={styles.userName} numberOfLines={1}>
                {item.groupName}
              </Text>
              <Text style={styles.dot}>{'\u00B7'}</Text>
              <Text style={styles.activeChallengeLabel}>Active now</Text>
            </View>
          </View>
        </View>

        {/* Blurred photo or gradient placeholder */}
        <View style={styles.activeChallengeContainer}>
          {hasPhoto ? (
            <Image
              source={{ uri: item.blurredPhotoUrl }}
              style={styles.photo}
              contentFit="cover"
              blurRadius={20}
              transition={200}
              recyclingKey={`blur_${item.id}`}
            />
          ) : (
            <LinearGradient
              colors={[theme.bgElevated, theme.surface, theme.bgElevated]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          )}

          {/* Dark overlay */}
          <Animated.View
            style={[
              styles.activeChallengeOverlay,
              { opacity: overlayOpacity },
            ]}
          />

          {/* Center content */}
          <View style={styles.activeChallengeCenter}>
            <View style={styles.lockIconCircle}>
              <Lock size={28} color={theme.white} />
            </View>

            {item.challengePrompt ? (
              <Text style={styles.activeChallengePrompt} numberOfLines={2}>
                {item.challengePrompt}
              </Text>
            ) : null}

            <Text style={styles.activeChallengeRevealText}>
              Respond to reveal
            </Text>

            {respondedText ? (
              <Text style={styles.activeChallengeCount}>{respondedText}</Text>
            ) : null}

            <View style={styles.respondPill}>
              <LinearGradient
                colors={[theme.coral, theme.coralDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.respondPillGradient}
              >
                <Zap size={16} color={theme.white} fill={theme.white} />
                <Text style={styles.respondPillText}>
                  {item.challengeType === 'snap' ? 'Take a photo' : 'Respond now'}
                </Text>
              </LinearGradient>
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Main FeedItem Component ──

function FeedItemComponent({ item }: { item: FeedItemData }) {
  switch (item.type) {
    case 'photo':
      return <PhotoFeedItem item={item} />;
    case 'locked_photo':
      return <LockedPhotoFeedItem item={item} />;
    case 'quiz_result':
      return <QuizResultFeedItem item={item} />;
    case 'ai_commentary':
      return <AICommentaryFeedItem item={item} />;
    case 'spotlight':
      return <SpotlightFeedItem item={item} />;
    case 'active_challenge':
      return <ActiveChallengeFeedItem item={item} />;
    default:
      return null;
  }
}

const FeedItem = React.memo(FeedItemComponent);
export default FeedItem;

// ── Styles ──

const styles = StyleSheet.create({
  // ── Photo Item ──
  photoItem: {
    marginBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'nowrap',
  },
  userName: {
    ...typography.labelLarge,
    color: theme.text,
    flexShrink: 0,
  },
  dot: {
    ...typography.bodySmall,
    color: theme.textMuted,
  },
  groupName: {
    ...typography.bodySmall,
    color: theme.textSecondary,
    flexShrink: 1,
  },
  timeAgo: {
    ...typography.bodySmall,
    color: theme.textMuted,
    flexShrink: 0,
  },
  photoContainer: {
    width: SCREEN_WIDTH,
    aspectRatio: 5 / 4, // width:height so 4:5 means height is taller
    borderRadius: 4,
    overflow: 'hidden',
    alignSelf: 'center',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  challengePrompt: {
    ...typography.bodySmall,
    color: theme.textMuted,
    fontStyle: 'italic',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  reactionsContainer: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  existingReactions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    ...typography.bodySmall,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  quickReactRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quickReactBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickReactEmoji: {
    fontSize: 16,
  },

  // ── Locked Photo Item ──
  lockedPhotoContainer: {
    width: SCREEN_WIDTH,
    aspectRatio: 5 / 4,
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.bgElevated,
  },
  lockedCenter: {
    alignItems: 'center',
    gap: spacing.md,
    zIndex: 1,
  },
  lockIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  lockedTitle: {
    ...typography.bodyLarge,
    color: theme.textSecondary,
    fontWeight: '500',
    textAlign: 'center',
  },
  respondPill: {
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  respondPillGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
  },
  respondPillText: {
    ...typography.labelLarge,
    color: theme.white,
    fontWeight: '700',
  },

  // ── Quiz Result Item ──
  quizItem: {
    marginBottom: spacing.xl,
  },
  quizIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quizIconEmoji: {
    fontSize: 16,
  },
  quizLabel: {
    ...typography.bodySmall,
    color: theme.purple,
    fontWeight: '600',
  },
  quizCard: {
    marginHorizontal: spacing.lg,
  },
  quizQuestion: {
    ...typography.headlineMedium,
    color: theme.text,
    marginBottom: spacing.lg,
  },
  quizResultsList: {
    gap: spacing.md,
  },
  quizResultRow: {
    gap: spacing.xs,
  },
  quizResultInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quizResultName: {
    ...typography.bodyMedium,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  quizResultNameWinner: {
    color: theme.text,
    fontWeight: '700',
  },
  quizResultVotes: {
    ...typography.bodySmall,
    color: theme.textMuted,
  },
  quizBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  quizBarFill: {
    height: '100%',
    borderRadius: 3,
  },

  // ── AI Commentary Item ──
  aiItem: {
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  aiCard: {
    borderWidth: 1,
    borderColor: theme.purpleMuted,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  aiHeaderText: {
    ...typography.labelSmall,
    color: theme.purple,
  },
  aiCommentary: {
    ...typography.bodyLarge,
    color: theme.textSecondary,
    fontStyle: 'italic',
    lineHeight: 24,
  },

  // ── Spotlight Item ──
  spotlightItem: {
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  spotlightCard: {
    borderWidth: 1,
    borderColor: theme.yellowMuted,
  },
  spotlightInner: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  spotlightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  spotlightLabel: {
    ...typography.labelSmall,
    color: theme.yellow,
  },
  spotlightUser: {
    ...typography.headlineLarge,
    color: theme.text,
  },
  spotlightSuperlative: {
    ...typography.bodyLarge,
    color: theme.textSecondary,
    fontStyle: 'italic',
  },
  spotlightFact: {
    ...typography.bodySmall,
    color: theme.textMuted,
    marginTop: spacing.xs,
  },

  // ── Active Challenge Item ──
  activeChallengeIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.coralMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeChallengeLabel: {
    ...typography.bodySmall,
    color: theme.coral,
    fontWeight: '600',
  },
  activeChallengeContainer: {
    width: SCREEN_WIDTH,
    aspectRatio: 5 / 4,
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.bgElevated,
  },
  activeChallengeOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 11, 16, 0.6)',
  },
  activeChallengeCenter: {
    alignItems: 'center',
    gap: spacing.sm,
    zIndex: 1,
    paddingHorizontal: spacing.xl,
  },
  activeChallengePrompt: {
    ...typography.headlineMedium,
    color: theme.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  activeChallengeRevealText: {
    ...typography.bodyLarge,
    color: theme.textSecondary,
    fontWeight: '500',
    textAlign: 'center',
  },
  activeChallengeCount: {
    ...typography.bodySmall,
    color: theme.textMuted,
    textAlign: 'center',
  },
});
