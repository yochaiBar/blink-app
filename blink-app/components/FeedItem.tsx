import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Platform } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import AvatarRing from '@/components/ui/AvatarRing';
import PhotoCommentsPreview from '@/components/PhotoCommentsPreview';
import { getLocalPhotoUri } from '@/services/photoStore';

// ── Types ──

// 'photo' renders here (group mini-feed); 'challenge_card' renders via ChallengeCard (Home).
export type FeedItemType = 'photo' | 'challenge_card';

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
  reactions?: { emoji: string; count: number }[];
  // Challenge card (challenge-grouped feed)
  responseCount?: number;
  memberCount?: number;
  isLive?: boolean;
  expiresAt?: string;
  challengeResponses?: { responseId: string; userName?: string; photoUrl?: string }[];
  // Sortable timestamp (ISO string)
  timestamp?: string;
  // Callbacks passed through
  onPress?: () => void;
  onRespond?: () => void;
  onReact?: (emoji: string) => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const QUICK_REACTIONS = ['\uD83D\uDD25', '\uD83D\uDC80', '\uD83D\uDE0D', '\uD83D\uDE02', '\uD83D\uDC40'];

// ── Photo Feed Item ──

function PhotoFeedItem({ item }: { item: FeedItemData }) {
  // The Blinks feed assigns id as `photo_${responseId}` — peel back to the
  // raw response_id so the comments hook can fetch/post against it. If the
  // id doesn't follow the convention, skip the comments section entirely.
  const responseId = item.id.startsWith('photo_') ? item.id.slice('photo_'.length) : null;

  // E2E photo flow (Phase 5): resolve the image URI from the local sandbox
  // first. v2 responses arrive via /api/photos/relay → photoStore; the feed
  // item itself carries no S3 URL. v1 responses fall back to item.photoUrl
  // (S3). useSocket invalidates ['localPhoto', response_id] when a photo
  // lands; this query re-runs and the Image swaps the source.
  const localPhotoQuery = useQuery({
    queryKey: ['localPhoto', responseId],
    queryFn: () => (responseId ? getLocalPhotoUri(responseId) : null),
    enabled: !!responseId,
    staleTime: 30_000,
  });
  const effectivePhotoUri = localPhotoQuery.data ?? item.photoUrl;

  const { onReact, onPress } = item;
  const handleReact = useCallback(
    (emoji: string) => {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      onReact?.(emoji);
    },
    [onReact],
  );

  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress?.();
  }, [onPress]);

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

        {/* Full-width photo — local sandbox first (v2), S3 fallback (v1).
            Shows a skeleton when the photo hasn't arrived yet (e.g. a v2
            response we just heard about via socket but the relay frame
            hasn't landed). Server-side pickup_request will get it sent. */}
        <View style={styles.photoContainer}>
          {effectivePhotoUri ? (
            <Image
              source={{ uri: effectivePhotoUri }}
              style={styles.photo}
              contentFit="cover"
              transition={200}
              recyclingKey={item.id}
            />
          ) : (
            <View style={[styles.photo, styles.photoPending]} />
          )}
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

        {responseId ? <PhotoCommentsPreview responseId={responseId} /> : null}
      </View>
    </TouchableOpacity>
  );
}

// ── Main FeedItem Component ──

function FeedItemComponent({ item }: { item: FeedItemData }) {
  return item.type === 'photo' ? <PhotoFeedItem item={item} /> : null;
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
  photoPending: {
    backgroundColor: theme.bgCardSolid,
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
});
