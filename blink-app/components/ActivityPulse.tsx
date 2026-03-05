import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '@/constants/colors';

interface RespondedUser {
  userId: string;
  displayName: string;
  avatarUrl?: string;
}

export interface ActivityPulseProps {
  respondedUsers: RespondedUser[];
  totalMembers: number;
  currentUserId: string;
  hasResponded: boolean;
}

const AVATAR_SIZE = 28;
const OVERLAP = 8;
const MAX_VISIBLE = 6;

export default function ActivityPulse({
  respondedUsers,
  totalMembers,
  currentUserId,
  hasResponded,
}: ActivityPulseProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;

  const respondedCount = respondedUsers.length;
  const notRespondedCount = totalMembers - respondedCount;
  const everyoneResponded = respondedCount >= totalMembers && totalMembers > 0;
  const justUserLeft =
    !hasResponded && notRespondedCount === 1 && totalMembers > 1;

  useEffect(() => {
    if (!hasResponded && !everyoneResponded) {
      const pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      const glowLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 0.7,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      pulseLoop.start();
      glowLoop.start();
      return () => {
        pulseLoop.stop();
        glowLoop.stop();
      };
    }
  }, [hasResponded, everyoneResponded, pulseAnim, glowAnim]);

  // Build avatar list: responded users first, then placeholders
  const respondedVisible = respondedUsers.slice(0, MAX_VISIBLE);
  const placeholderCount = Math.min(
    notRespondedCount,
    MAX_VISIBLE - respondedVisible.length
  );

  const statusText = everyoneResponded
    ? "Everyone's in!"
    : justUserLeft
    ? 'Just you left!'
    : `${respondedCount}/${totalMembers} responded`;

  return (
    <View style={styles.container}>
      <View style={styles.avatarRow}>
        {respondedVisible.map((u, i) => (
          <View
            key={u.userId}
            style={[
              styles.avatarWrapper,
              { marginLeft: i > 0 ? -OVERLAP : 0, zIndex: MAX_VISIBLE - i },
            ]}
          >
            <Image
              source={{
                uri:
                  u.avatarUrl ||
                  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop',
              }}
              style={styles.avatar}
              contentFit="cover"
            />
          </View>
        ))}
        {Array.from({ length: placeholderCount }).map((_, i) => (
          <Animated.View
            key={`placeholder-${i}`}
            style={[
              styles.avatarWrapper,
              styles.placeholderWrapper,
              {
                marginLeft: respondedVisible.length > 0 || i > 0 ? -OVERLAP : 0,
                zIndex: MAX_VISIBLE - respondedVisible.length - i,
                transform: !hasResponded ? [{ scale: pulseAnim }] : [],
                opacity: !hasResponded ? glowAnim : 1,
              },
            ]}
          >
            <Text style={styles.placeholderText}>?</Text>
          </Animated.View>
        ))}
      </View>
      <View style={styles.statusRow}>
        {everyoneResponded && <Text style={styles.checkmark}>&#x2705;</Text>}
        <Text
          style={[
            styles.statusText,
            everyoneResponded && { color: theme.green },
            justUserLeft && { color: theme.coral },
          ]}
        >
          {statusText}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    gap: 6,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrapper: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    borderColor: theme.bg,
    overflow: 'hidden',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: AVATAR_SIZE / 2,
  },
  placeholderWrapper: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
  },
  placeholderText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.textMuted,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  checkmark: {
    fontSize: 12,
  },
  statusText: {
    fontSize: 12,
    color: theme.textSecondary,
    fontWeight: '600',
  },
});
