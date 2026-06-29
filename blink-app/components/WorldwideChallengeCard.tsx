import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Globe2, Users } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import { WorldwideChallenge } from '@/constants/worldwideExamples';

interface WorldwideChallengeCardProps {
  challenge: WorldwideChallenge;
  onRespond?: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_PADDING = spacing.lg;
const PHOTO_GAP = 6;
// 2 full photos + 1 "+N" tile, equal width
const PHOTO_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - PHOTO_GAP * 2) / 3;
const PHOTO_HEIGHT = PHOTO_WIDTH * 1.3;

export default React.memo(function WorldwideChallengeCard({
  challenge,
  onRespond,
}: WorldwideChallengeCardProps) {
  const [photo1, photo2] = challenge.photos;
  const remaining = challenge.totalCount - 2;
  const locationLine = challenge.photos
    .slice(0, 3)
    .map((p) => p.location)
    .join(' · ');

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Globe2 size={14} color={theme.coral} />
          <Text style={styles.headerText}>
            <Text style={styles.headerCount}>{challenge.totalCount} people</Text>
            {' responded · '}
            <Text style={styles.headerTime}>{challenge.timeAgo}</Text>
          </Text>
        </View>
      </View>

      {/* Prompt */}
      <Text style={styles.prompt} numberOfLines={2}>
        {challenge.prompt}
      </Text>

      {/* Photo grid: 2 clear + 1 "+N" tile */}
      <View style={styles.photoRow}>
        {photo1 ? (
          <View style={styles.photoWrapper}>
            <Image
              source={{ uri: photo1.photoUrl }}
              style={styles.photo}
              contentFit="cover"
              transition={200}
              recyclingKey={photo1.id}
            />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.45)']}
              style={styles.photoGradient}
            />
            <Text style={styles.photoLocation} numberOfLines={1}>
              {photo1.location}
            </Text>
          </View>
        ) : null}

        {photo2 ? (
          <View style={styles.photoWrapper}>
            <Image
              source={{ uri: photo2.photoUrl }}
              style={styles.photo}
              contentFit="cover"
              transition={200}
              recyclingKey={photo2.id}
            />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.45)']}
              style={styles.photoGradient}
            />
            <Text style={styles.photoLocation} numberOfLines={1}>
              {photo2.location}
            </Text>
          </View>
        ) : null}

        {/* "+N more" tile — blurred preview of 3rd photo */}
        <View style={styles.photoWrapper}>
          {challenge.photos[2] ? (
            <Image
              source={{ uri: challenge.photos[2].photoUrl }}
              style={styles.photo}
              contentFit="cover"
              blurRadius={18}
              recyclingKey={`blur_${challenge.photos[2].id}`}
            />
          ) : (
            <LinearGradient
              colors={[theme.bgElevated, theme.surface]}
              style={styles.photo}
            />
          )}
          <View style={styles.moreOverlay}>
            <Text style={styles.moreCount}>+{remaining}</Text>
            <Text style={styles.moreLabel}>more</Text>
          </View>
        </View>
      </View>

      {/* Locations row */}
      <View style={styles.locationsRow}>
        <Users size={12} color={theme.textMuted} />
        <Text style={styles.locationsText} numberOfLines={1}>
          {locationLine}
          {challenge.totalCount > 3 ? ` · +${challenge.totalCount - 3} more cities` : ''}
        </Text>
      </View>

      {/* Reactions */}
      {challenge.reactions.length > 0 ? (
        <View style={styles.reactionsRow}>
          {challenge.reactions.map((r, i) => (
            <View key={i} style={styles.reactionPill}>
              <Text style={styles.reactionEmoji}>{r.emoji}</Text>
              <Text style={styles.reactionCount}>{r.count}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* CTA */}
      <TouchableOpacity activeOpacity={0.85} onPress={onRespond} style={styles.ctaButton}>
        <LinearGradient
          colors={[theme.coral, theme.coralDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.ctaGradient}
        >
          <Text style={styles.ctaText}>Respond to unlock all</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    backgroundColor: theme.bgElevated,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    padding: CARD_PADDING,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  headerText: {
    ...typography.bodySmall,
    color: theme.textSecondary,
  },
  headerCount: {
    ...typography.labelSmall,
    color: theme.text,
  },
  headerTime: {
    color: theme.textMuted,
  },
  prompt: {
    ...typography.headlineMedium,
    color: theme.text,
    marginBottom: spacing.md,
  },
  photoRow: {
    flexDirection: 'row',
    gap: PHOTO_GAP,
    marginBottom: spacing.sm,
  },
  photoWrapper: {
    width: PHOTO_WIDTH,
    height: PHOTO_HEIGHT,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  photo: {
    width: PHOTO_WIDTH,
    height: PHOTO_HEIGHT,
  },
  photoGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  photoLocation: {
    ...typography.labelSmall,
    color: theme.white,
    position: 'absolute',
    bottom: 5,
    left: 6,
    right: 4,
    fontSize: 10,
  },
  moreOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreCount: {
    ...typography.headlineMedium,
    color: theme.white,
    fontSize: 20,
  },
  moreLabel: {
    ...typography.bodySmall,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
  },
  locationsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: spacing.sm,
    marginTop: 2,
  },
  locationsText: {
    ...typography.bodySmall,
    color: theme.textMuted,
    flex: 1,
    fontSize: 12,
  },
  reactionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: theme.surface,
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    ...typography.labelSmall,
    color: theme.textSecondary,
    fontSize: 12,
  },
  ctaButton: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  ctaGradient: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    ...typography.labelLarge,
    color: theme.white,
  },
});
