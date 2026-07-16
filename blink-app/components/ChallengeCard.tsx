import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { ChevronRight, Camera } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import { FeedItemData } from '@/components/FeedItem';
import { getLocalPhotoUri } from '@/services/photoStore';

const MAX_THUMBS = 4;

// ── Helpers ──

function typeBadge(t?: string): string {
  switch (t) {
    case 'snap':
      return '📸 Snap';
    case 'quiz':
    case 'quiz_food':
      return '❓ Quiz';
    case 'quiz_most_likely':
      return '🔥 Most likely';
    case 'quiz_rate_day':
      return '⭐ Rate the day';
    case 'prompt':
      return '💬 Prompt';
    default:
      return '📸 Snap';
  }
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Live countdown pill ──

function LivePill({ expiresAt }: { expiresAt?: string }) {
  const [remaining, setRemaining] = useState<number>(() =>
    expiresAt ? new Date(expiresAt).getTime() - Date.now() : 0,
  );
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setRemaining(new Date(expiresAt).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] });

  return (
    <View style={[styles.statePill, styles.statePillLive]}>
      <Animated.View style={[styles.liveDot, { opacity: dotOpacity }]} />
      <Text style={styles.statePillLiveText}>
        LIVE{expiresAt ? ` · ${formatRemaining(remaining)}` : ''}
      </Text>
    </View>
  );
}

// ── Response thumbnail (E2E local photo first, S3 fallback) ──

function ResponseThumb({
  responseId,
  photoUrl,
  overlay,
}: {
  responseId: string;
  photoUrl?: string;
  overlay?: string;
}) {
  const localPhoto = useQuery({
    queryKey: ['localPhoto', responseId],
    queryFn: () => getLocalPhotoUri(responseId),
    enabled: !!responseId,
    staleTime: 30_000,
  });
  const uri = localPhoto.data ?? photoUrl;

  return (
    <View style={styles.thumb}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumbImg} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.thumbImg, styles.thumbPending]} />
      )}
      {overlay ? (
        <View style={styles.thumbOverlay}>
          <Text style={styles.thumbOverlayText}>{overlay}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Challenge Card ──

export default function ChallengeCard({ item }: { item: FeedItemData }) {
  const accent = theme.coral;
  const responded =
    item.responseCount != null && item.memberCount != null
      ? `${item.responseCount}/${item.memberCount} answered`
      : item.responseCount != null
        ? `${item.responseCount} answered`
        : '';

  const handleRespond = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    item.onRespond?.();
  };
  const handlePress = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    item.onPress?.();
  };

  return (
    <TouchableOpacity activeOpacity={item.isLive ? 1 : 0.9} onPress={item.isLive ? undefined : handlePress}>
      <View style={styles.card}>
        <View style={[styles.ribbon, { backgroundColor: accent }]} />

        {/* Top row: audience + state */}
        <View style={styles.topRow}>
          <View style={styles.audience}>
            <View style={[styles.groupChip, { backgroundColor: accent }]}>
              <Text style={styles.groupChipEmoji}>{item.groupEmoji || '⚡'}</Text>
            </View>
            <Text style={styles.groupName} numberOfLines={1}>
              {item.groupName || 'Group'}
            </Text>
          </View>
          {item.isLive ? (
            <LivePill expiresAt={item.expiresAt} />
          ) : (
            <View style={styles.statePill}>
              <Text style={styles.statePillText}>CLOSED</Text>
            </View>
          )}
        </View>

        {/* Type badge */}
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>{typeBadge(item.challengeType)}</Text>
        </View>

        {/* Prompt */}
        {item.challengePrompt ? (
          <Text style={styles.prompt} numberOfLines={3}>
            {item.challengePrompt}
          </Text>
        ) : null}

        {/* Response thumbnails (closed challenges) */}
        {!item.isLive && item.challengeResponses && item.challengeResponses.length > 0 ? (
          <View style={styles.thumbRow}>
            {item.challengeResponses.slice(0, MAX_THUMBS).map((r, i) => {
              const isLast = i === MAX_THUMBS - 1;
              const extra = (item.challengeResponses?.length ?? 0) - MAX_THUMBS;
              return (
                <ResponseThumb
                  key={r.responseId}
                  responseId={r.responseId}
                  photoUrl={r.photoUrl}
                  overlay={isLast && extra > 0 ? `+${extra}` : undefined}
                />
              );
            })}
          </View>
        ) : null}

        {/* Footer: participation + action */}
        <View style={styles.footer}>
          <Text style={styles.participation}>{responded}</Text>
          {item.isLive ? (
            <TouchableOpacity
              style={[styles.cta, { backgroundColor: accent }]}
              onPress={handleRespond}
              activeOpacity={0.85}
            >
              <Camera size={15} color={theme.white} />
              <Text style={styles.ctaText}>Add yours</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.viewLink}>
              <Text style={[styles.viewLinkText, { color: accent }]}>See responses</Text>
              <ChevronRight size={15} color={accent} />
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: borderRadius.xl,
    backgroundColor: theme.bgCardSolid,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    gap: spacing.md,
  },
  ribbon: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  audience: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  groupChip: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupChipEmoji: { fontSize: 13 },
  groupName: {
    ...typography.labelLarge,
    color: theme.text,
    fontWeight: '700',
    flexShrink: 1,
  },
  statePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: theme.surface,
  },
  statePillText: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.textMuted,
    letterSpacing: 0.4,
  },
  statePillLive: {
    backgroundColor: theme.redMuted,
  },
  statePillLiveText: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.red,
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.red,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: theme.surface,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  prompt: {
    ...typography.headlineMedium,
    color: theme.text,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 26,
  },
  thumbRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  thumb: {
    flex: 1,
    aspectRatio: 3 / 4,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: theme.surface,
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  thumbPending: {
    backgroundColor: theme.surface,
  },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 11, 16, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbOverlayText: {
    ...typography.labelLarge,
    color: theme.white,
    fontWeight: '800',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  participation: {
    ...typography.bodySmall,
    color: theme.textMuted,
    fontWeight: '600',
    flexShrink: 1,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 1,
    borderRadius: borderRadius.full,
  },
  ctaText: {
    ...typography.labelSmall,
    color: theme.white,
    fontWeight: '800',
  },
  viewLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewLinkText: {
    ...typography.labelSmall,
    fontWeight: '700',
  },
});
