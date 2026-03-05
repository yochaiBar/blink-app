import React, { useRef, useCallback, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Image } from 'expo-image';
import { ChevronRight, Clock } from 'lucide-react-native';
import { Group } from '@/types';
import { theme } from '@/constants/colors';
import { categoryLabels } from '@/constants/categories';
import { getRelativeTime } from '@/utils/time';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import StreakIcon from '@/components/StreakIcon';

interface GroupCardProps {
  group: Group;
  onPress: () => void;
}

export default React.memo(function GroupCard({ group, onPress }: GroupCardProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [countdown, setCountdown] = useState<string>(group.challengeDeadline ?? '');

  useEffect(() => {
    if (!group.challengeEndTime) return;
    const update = () => {
      const remaining = Math.max(0, (group.challengeEndTime ?? 0) - Date.now());
      if (remaining <= 0) {
        setCountdown('0:00');
        return;
      }
      const hrs = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      if (hrs > 0) {
        setCountdown(`${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      } else {
        setCountdown(`${mins}:${secs.toString().padStart(2, '0')}`);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [group.challengeEndTime]);

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
    onPress();
  }, [onPress]);

  const displayedMembers = group.members.slice(0, 4);
  const extraCount = group.members.length - 4;

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        style={[styles.container, { borderLeftColor: group.color, borderLeftWidth: 3 }]}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        testID={`group-card-${group.id}`}
      >
        <View style={styles.topRow}>
          <View style={styles.titleArea}>
            <Text style={styles.emoji}>{group.emoji}</Text>
            <View>
              <Text style={styles.name}>{group.name}</Text>
              <Text style={[styles.category, { color: group.color }]}>
                {categoryLabels[group.category]}
              </Text>
            </View>
          </View>
          <ChevronRight size={18} color={theme.textMuted} />
        </View>

        <View style={styles.bottomRow}>
          <View style={styles.avatarStack}>
            {displayedMembers.map((member, i) => (
              <View key={member.id} style={[styles.avatarContainer, { marginLeft: i > 0 ? -10 : 0, zIndex: displayedMembers.length - i }]}>
                <Image
                  source={{ uri: member.avatar }}
                  style={styles.avatar}
                  contentFit="cover"
                />
                {member.isOnline && <View style={styles.onlineDot} />}
              </View>
            ))}
            {extraCount > 0 && (
              <View style={[styles.avatarContainer, styles.extraBadge, { marginLeft: -10 }]}>
                <Text style={styles.extraText}>+{extraCount}</Text>
              </View>
            )}
          </View>

          <View style={styles.metaArea}>
            {(() => {
              const topStreak = group.members.reduce((max, m) => Math.max(max, m.streak), 0);
              if (topStreak >= 3) {
                return (
                  <View style={styles.streakBadge}>
                    <StreakIcon streak={topStreak} size={14} />
                    <Text style={styles.streakNumber}>{topStreak}</Text>
                  </View>
                );
              }
              return null;
            })()}
            {group.hasActiveChallenge ? (
              <View style={styles.challengeBadge}>
                <Clock size={12} color={theme.coral} />
                <Text style={styles.challengeText}>{countdown || group.challengeDeadline}</Text>
              </View>
            ) : (
              <Text style={styles.lastActive}>{getRelativeTime(group.lastActive)}</Text>
            )}
          </View>
        </View>

        {group.hasActiveChallenge && (
          <View style={[styles.activeBanner, { backgroundColor: theme.coralMuted }]}>
            <Text style={styles.activeBannerText}>📸 Snap Challenge active!</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.bgCard,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  titleArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emoji: {
    fontSize: 28,
  },
  name: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: theme.text,
    letterSpacing: -0.3,
  },
  category: {
    fontSize: 12,
    fontWeight: '600' as const,
    marginTop: 2,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: theme.bgCard,
    overflow: 'visible',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 15,
  },
  onlineDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: theme.green,
    borderWidth: 2,
    borderColor: theme.bgCard,
  },
  extraBadge: {
    backgroundColor: theme.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  extraText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: theme.textSecondary,
  },
  metaArea: {
    alignItems: 'flex-end',
    gap: 6,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  streakNumber: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: theme.yellow,
    fontVariant: ['tabular-nums'],
  },
  challengeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.coralMuted,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  challengeText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: theme.coral,
    fontVariant: ['tabular-nums'],
  },
  lastActive: {
    fontSize: 12,
    color: theme.textMuted,
  },
  activeBanner: {
    marginTop: 12,
    marginHorizontal: -16,
    marginBottom: -16,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  activeBannerText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: theme.coral,
    textAlign: 'center',
  },
});
