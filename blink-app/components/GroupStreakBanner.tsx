import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { theme } from '@/constants/colors';
import StreakIcon from '@/components/StreakIcon';

export interface GroupStreakBannerProps {
  groupStreak: number;
  longestGroupStreak: number;
}

export default function GroupStreakBanner({
  groupStreak,
  longestGroupStreak,
}: GroupStreakBannerProps) {
  const slideAnim = useRef(new Animated.Value(-30)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, [slideAnim, fadeAnim]);

  return (
    <Animated.View
      style={[
        styles.container,
        groupStreak > 0 ? styles.activeContainer : styles.inactiveContainer,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      {groupStreak > 0 ? (
        <>
          <View style={styles.mainRow}>
            <StreakIcon streak={groupStreak} size={18} />
            <Text style={styles.activeText}>
              Group Streak: {groupStreak} day{groupStreak !== 1 ? 's' : ''} — everyone showed up!
            </Text>
          </View>
          {longestGroupStreak > 0 && (
            <Text style={styles.bestText}>
              Best: {longestGroupStreak} day{longestGroupStreak !== 1 ? 's' : ''}
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.inactiveText}>
          Start a group streak — get everyone to respond!
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 12,
    padding: 12,
  },
  activeContainer: {
    backgroundColor: theme.coralMuted,
  },
  inactiveContainer: {
    backgroundColor: theme.bgCard,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activeText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.coral,
    flex: 1,
  },
  bestText: {
    fontSize: 11,
    color: theme.textMuted,
    marginTop: 4,
    marginLeft: 24,
  },
  inactiveText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textMuted,
    textAlign: 'center',
  },
});
