import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronRight } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';

const SCREEN_WIDTH = Dimensions.get('window').width;
const THUMB_COLS = 3;
const THUMB_GAP = spacing.xs;
const THUMB_SIZE = (SCREEN_WIDTH - spacing.lg * 2 - THUMB_GAP * (THUMB_COLS - 1)) / THUMB_COLS;

export interface GroupPhoto {
  id: string;
  challenge_id: string;
  photo_url: string;
  responded_at: string;
  prompt: string | null;
  challenge_type: string;
  display_name: string;
  avatar_url: string | null;
}

function getRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export interface PhotoTimelineProps {
  photos: GroupPhoto[];
  groupId: string;
  onSeeAll: () => void;
}

export default function PhotoTimeline({
  photos,
  groupId,
  onSeeAll,
}: PhotoTimelineProps) {
  const router = useRouter();
  if (photos.length === 0) return null;

  return (
    <View style={styles.pastSection}>
      <View style={styles.pastHeader}>
        <Text style={[typography.headlineMedium, { color: theme.text }]}>Moments</Text>
        {photos.length > 9 && (
          <TouchableOpacity onPress={onSeeAll} style={styles.seeAllBtn}>
            <Text style={styles.seeAllText}>See all</Text>
            <ChevronRight size={14} color={theme.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.thumbGrid}>
        {photos.slice(0, 9).map((photo) => (
          <TouchableOpacity
            key={photo.id}
            style={styles.thumbItem}
            activeOpacity={0.8}
            onPress={() =>
              router.push({
                pathname: '/challenge-reveal' as never,
                params: { challengeId: photo.challenge_id, groupId },
              })
            }
          >
            <Image
              source={{ uri: photo.photo_url }}
              style={styles.thumbImage}
              contentFit="cover"
              transition={200}
            />
            <View style={styles.thumbOverlayBottom}>
              <Image
                source={{ uri: photo.avatar_url ?? 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop' }}
                style={styles.thumbAvatar}
                contentFit="cover"
              />
              <Text style={styles.thumbTime} numberOfLines={1}>{getRelativeTime(photo.responded_at)}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pastSection: {
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  pastHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    ...typography.bodySmall,
    color: theme.textMuted,
    fontWeight: '600',
  },
  thumbGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: THUMB_GAP,
  },
  thumbItem: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: theme.surface,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbOverlayBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderBottomLeftRadius: borderRadius.md,
    borderBottomRightRadius: borderRadius.md,
  },
  thumbAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginRight: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  thumbTime: {
    color: '#fff',
    fontSize: 10,
    flex: 1,
  },
});
