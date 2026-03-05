import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '@/constants/colors';
import ActivityPulse, { ActivityPulseProps } from '@/components/ActivityPulse';

export interface BlurredPreviewCardProps {
  respondedCount: number;
  totalMembers: number;
  totalReactions: number;
  topReactionEmoji?: string;
  respondedUsers: Array<{ displayName: string; avatarUrl?: string }>;
  onRespond: () => void;
  activityPulseProps?: ActivityPulseProps;
}

const PLACEHOLDER_COLORS = [
  `${theme.coral}30`,
  `${theme.purple}25`,
  `${theme.blue}20`,
];

export default function BlurredPreviewCard({
  respondedCount,
  totalMembers,
  totalReactions,
  topReactionEmoji,
  respondedUsers,
  onRespond,
  activityPulseProps,
}: BlurredPreviewCardProps) {
  const breatheAnim = useRef(new Animated.Value(0)).current;
  const fadeInAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeInAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(breatheAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    );
    breatheLoop.start();
    return () => breatheLoop.stop();
  }, [breatheAnim, fadeInAnim]);

  const translateY = breatheAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -4],
  });

  const scale = breatheAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.01],
  });

  const respondedNames = respondedUsers
    .slice(0, 3)
    .map((u) => u.displayName)
    .join(', ');

  return (
    <Animated.View style={[styles.wrapper, { opacity: fadeInAnim }]}>
      {activityPulseProps && <ActivityPulse {...activityPulseProps} />}

      <View style={styles.cardsContainer}>
        {PLACEHOLDER_COLORS.map((color, i) => (
          <Animated.View
            key={i}
            style={[
              styles.fakeCard,
              {
                backgroundColor: color,
                transform: [
                  { translateY },
                  { scale },
                  { rotate: `${(i - 1) * 2}deg` },
                ],
                zIndex: 3 - i,
                top: i * 6,
                left: i * 4,
              },
            ]}
          >
            <View style={styles.blurOverlay} />
            {/* Fake content shapes */}
            <View style={styles.fakeAvatarRow}>
              <View style={styles.fakeAvatar} />
              <View style={styles.fakeNameBar} />
            </View>
            <View style={styles.fakeImageArea} />
          </Animated.View>
        ))}
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.friendsText}>
          {respondedCount} friend{respondedCount !== 1 ? 's' : ''} already
          responded
        </Text>

        {respondedUsers.length > 0 && (
          <View style={styles.respondedAvatars}>
            {respondedUsers.slice(0, 4).map((u, i) => (
              <Image
                key={i}
                source={{
                  uri:
                    u.avatarUrl ||
                    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop',
                }}
                style={[
                  styles.respondedAvatar,
                  { marginLeft: i > 0 ? -6 : 0, zIndex: 4 - i },
                ]}
                contentFit="cover"
              />
            ))}
            {respondedUsers.length > 4 && (
              <Text style={styles.moreText}>
                +{respondedUsers.length - 4}
              </Text>
            )}
          </View>
        )}

        {totalReactions > 0 && (
          <Text style={styles.reactionsText}>
            {totalReactions} reaction{totalReactions !== 1 ? 's' : ''} so far{' '}
            {topReactionEmoji || '\uD83D\uDD25'}
          </Text>
        )}

        <TouchableOpacity
          style={styles.respondButton}
          onPress={onRespond}
          activeOpacity={0.85}
        >
          <Text style={styles.respondButtonText}>Respond to unlock</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 16,
    gap: 12,
  },
  cardsContainer: {
    height: 180,
    position: 'relative',
    marginBottom: 8,
  },
  fakeCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 160,
    borderRadius: 16,
    padding: 12,
    overflow: 'hidden',
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 10, 15, 0.55)',
    borderRadius: 16,
  },
  fakeAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    zIndex: 1,
  },
  fakeAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  fakeNameBar: {
    width: 80,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  fakeImageArea: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    zIndex: 1,
  },
  infoSection: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  friendsText: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.text,
    textAlign: 'center',
  },
  respondedAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  respondedAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: theme.bg,
  },
  moreText: {
    fontSize: 11,
    color: theme.textMuted,
    marginLeft: 6,
  },
  reactionsText: {
    fontSize: 13,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  respondButton: {
    backgroundColor: theme.coral,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  respondButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.white,
  },
});
