import React, { useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Zap, Lock, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import GlassCard from '@/components/ui/GlassCard';
import AvatarRing from '@/components/ui/AvatarRing';

export interface BlinkMomentCardProps {
  groupName: string;
  groupEmoji: string;
  challengePrompt: string;
  challengeType: string;
  triggeredBy: string | null; // null = Blink AI
  timeAgo: string;
  responseCount: number;
  totalMembers: number;
  topReactionEmoji?: string;
  totalReactions?: number;
  previewAvatars: Array<{ uri?: string; name: string }>;
  isLocked: boolean;
  onPress: () => void;
  onRespond?: () => void;
}

const CHALLENGE_TYPE_EMOJI: Record<string, string> = {
  snap: '\uD83D\uDCF8',
  quiz: '\uD83E\uDDE0',
  quiz_food: '\uD83C\uDF54',
  quiz_most_likely: '\uD83D\uDC40',
  quiz_rate_day: '\u2B50',
  prompt: '\uD83D\uDCAC',
};

function getChallengeTypeLabel(type: string): string {
  if (type === 'snap') return 'Snap Challenge';
  if (type.includes('food')) return 'Food Quiz';
  if (type.includes('most_likely')) return 'Most Likely To';
  if (type.includes('rate')) return 'Rate Your Day';
  if (type.includes('quiz')) return 'Quiz';
  return 'Challenge';
}

export default React.memo(function BlinkMomentCard({
  groupName,
  groupEmoji,
  challengePrompt,
  challengeType,
  triggeredBy,
  timeAgo,
  responseCount,
  totalMembers,
  topReactionEmoji,
  totalReactions,
  previewAvatars,
  isLocked,
  onPress,
  onRespond,
}: BlinkMomentCardProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  // Locked card shimmer effect
  useEffect(() => {
    if (!isLocked) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isLocked, shimmerAnim]);

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
    if (isLocked && onRespond) {
      onRespond();
    } else {
      onPress();
    }
  }, [isLocked, onPress, onRespond]);

  const handleRespondPress = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onRespond?.();
  }, [onRespond]);

  const typeEmoji = CHALLENGE_TYPE_EMOJI[challengeType] ?? '\uD83D\uDCF8';
  const respondedText = `${responseCount}/${totalMembers} responded`;

  const frostedOpacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 0.85],
  });

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        activeOpacity={1}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
      >
        <GlassCard
          style={isLocked ? styles.cardLocked : styles.card}
          padding={0}
          borderRadius={borderRadius.xl}
        >
          <View style={styles.inner}>
            {/* Header Row */}
            <View style={styles.headerRow}>
              <View style={styles.headerLeft}>
                <Text style={styles.groupEmoji}>{groupEmoji}</Text>
                <Text style={styles.groupName} numberOfLines={1}>
                  {groupName}
                </Text>
                <Text style={styles.dot}>{'\u00B7'}</Text>
                <Text style={styles.timeAgo}>{timeAgo}</Text>
              </View>
              <View style={styles.headerRight}>
                <Text style={styles.respondedCount}>{respondedText}</Text>
              </View>
            </View>

            {/* Challenge Type + AI Label */}
            <View style={styles.metaRow}>
              <View style={styles.typePill}>
                <Text style={styles.typePillText}>
                  {typeEmoji} {getChallengeTypeLabel(challengeType)}
                </Text>
              </View>
              {triggeredBy === null && (
                <View style={styles.aiLabel}>
                  <Text style={styles.aiLabelText}>
                    {'\u2728'} Blink AI
                  </Text>
                </View>
              )}
            </View>

            {/* Challenge Prompt */}
            <Text
              style={styles.challengePrompt}
              numberOfLines={isLocked ? 2 : 3}
            >
              {challengePrompt}
            </Text>

            {/* Content Area */}
            {isLocked ? (
              /* Locked state with frosted overlay */
              <View style={styles.lockedContainer}>
                <Animated.View
                  style={[styles.frostedOverlay, { opacity: frostedOpacity }]}
                >
                  <LinearGradient
                    colors={[
                      'rgba(255, 107, 74, 0.08)',
                      'rgba(167, 139, 250, 0.06)',
                      'rgba(255, 107, 74, 0.04)',
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>

                {/* Blurred avatar hints */}
                <View style={styles.lockedAvatarRow}>
                  {previewAvatars.slice(0, 3).map((avatar, i) => (
                    <View
                      key={i}
                      style={[
                        styles.blurredAvatar,
                        { marginLeft: i > 0 ? -8 : 0, zIndex: 4 - i },
                      ]}
                    >
                      <AvatarRing
                        uri={avatar.uri}
                        name={avatar.name}
                        size={28}
                        showStatus
                        hasResponded
                        ringColor={theme.coral}
                      />
                    </View>
                  ))}
                  {previewAvatars.length > 3 && (
                    <Text style={styles.moreAvatarsText}>
                      +{previewAvatars.length - 3}
                    </Text>
                  )}
                </View>

                <Lock size={20} color={theme.textMuted} style={styles.lockIcon} />

                <Text style={styles.lockedText}>
                  Respond to see {responseCount} friend
                  {responseCount !== 1 ? 's\'' : '\'s'} submissions
                </Text>

                <TouchableOpacity
                  style={styles.respondButton}
                  onPress={handleRespondPress}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={[theme.coral, theme.coralDark]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.respondGradient}
                  >
                    <Zap size={16} color={theme.white} fill={theme.white} />
                    <Text style={styles.respondButtonText}>
                      Respond now{' \u2192'}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            ) : (
              /* Unlocked state — show preview */
              <View style={styles.unlockedContent}>
                {/* Responder avatars */}
                <View style={styles.avatarRow}>
                  {previewAvatars.slice(0, 4).map((avatar, i) => (
                    <View
                      key={i}
                      style={[
                        styles.avatarItem,
                        { marginLeft: i > 0 ? -6 : 0, zIndex: 5 - i },
                      ]}
                    >
                      <AvatarRing
                        uri={avatar.uri}
                        name={avatar.name}
                        size={32}
                        showStatus
                        hasResponded
                        ringColor={theme.coral}
                      />
                    </View>
                  ))}
                  {previewAvatars.length > 4 && (
                    <Text style={styles.moreText}>
                      +{previewAvatars.length - 4} more
                    </Text>
                  )}
                </View>

                {/* Reactions summary */}
                {totalReactions != null && totalReactions > 0 && (
                  <View style={styles.reactionsRow}>
                    <Text style={styles.reactionsText}>
                      {totalReactions} reaction
                      {totalReactions !== 1 ? 's' : ''}
                      {topReactionEmoji ? ` \u00B7 ${topReactionEmoji} most popular` : ''}
                    </Text>
                  </View>
                )}

                {/* View arrow */}
                <View style={styles.viewRow}>
                  <Text style={styles.viewText}>View responses</Text>
                  <ChevronRight size={16} color={theme.coral} />
                </View>
              </View>
            )}
          </View>
        </GlassCard>
      </TouchableOpacity>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  cardLocked: {
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: theme.coralMuted,
  },
  inner: {
    padding: spacing.lg,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  groupEmoji: {
    fontSize: 20,
  },
  groupName: {
    ...typography.labelLarge,
    color: theme.text,
    flexShrink: 1,
  },
  dot: {
    ...typography.bodySmall,
    color: theme.textMuted,
  },
  timeAgo: {
    ...typography.bodySmall,
    color: theme.textMuted,
  },
  headerRight: {
    marginLeft: spacing.sm,
  },
  respondedCount: {
    ...typography.bodySmall,
    color: theme.textSecondary,
    fontWeight: '600',
  },

  // Meta row
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  typePill: {
    backgroundColor: theme.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  typePillText: {
    ...typography.bodySmall,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  aiLabel: {
    backgroundColor: theme.purpleMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  aiLabelText: {
    ...typography.bodySmall,
    color: theme.purple,
    fontWeight: '600',
  },

  // Challenge prompt
  challengePrompt: {
    ...typography.headlineMedium,
    color: theme.text,
    marginBottom: spacing.md,
  },

  // Locked state
  lockedContainer: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(255, 107, 74, 0.04)',
  },
  frostedOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: borderRadius.lg,
  },
  lockedAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurredAvatar: {
    opacity: 0.7,
  },
  moreAvatarsText: {
    ...typography.bodySmall,
    color: theme.textMuted,
    marginLeft: spacing.sm,
    fontWeight: '600',
  },
  lockIcon: {
    marginTop: spacing.xs,
  },
  lockedText: {
    ...typography.bodyMedium,
    color: theme.textSecondary,
    textAlign: 'center',
    fontWeight: '500',
  },
  respondButton: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  respondGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  respondButtonText: {
    ...typography.labelLarge,
    color: theme.white,
    fontWeight: '700',
  },

  // Unlocked state
  unlockedContent: {
    gap: spacing.md,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarItem: {},
  moreText: {
    ...typography.bodySmall,
    color: theme.textMuted,
    marginLeft: spacing.sm,
    fontWeight: '600',
  },
  reactionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reactionsText: {
    ...typography.bodySmall,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  viewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  viewText: {
    ...typography.labelLarge,
    color: theme.coral,
  },
});
