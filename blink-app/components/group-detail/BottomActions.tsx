import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronRight, Trophy, Zap } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import GroupStreakBanner from '@/components/GroupStreakBanner';

export interface BottomActionsProps {
  isDemo: boolean;
  hasActiveChallenge: boolean;
  groupStreak: number;
  longestGroupStreak: number;
  leaderboardCount: number;
  onChallengeNow: () => void;
  onViewLeaderboard: () => void;
}

export default function BottomActions({
  isDemo,
  hasActiveChallenge,
  groupStreak,
  longestGroupStreak,
  leaderboardCount,
  onChallengeNow,
  onViewLeaderboard,
}: BottomActionsProps) {
  return (
    <View style={styles.bottomActions}>
      {!isDemo && groupStreak > 0 && (
        <GroupStreakBanner
          groupStreak={groupStreak}
          longestGroupStreak={longestGroupStreak}
        />
      )}

      {!isDemo && !hasActiveChallenge && (
        <TouchableOpacity
          style={styles.challengeNowBtn}
          onPress={onChallengeNow}
          activeOpacity={0.85}
        >
          <Zap size={20} color={theme.white} />
          <Text style={styles.challengeNowText}>Challenge Now</Text>
        </TouchableOpacity>
      )}

      {!isDemo && leaderboardCount > 0 && (
        <TouchableOpacity
          style={styles.leaderboardLink}
          onPress={onViewLeaderboard}
          activeOpacity={0.7}
        >
          <Trophy size={16} color={theme.yellow} />
          <Text style={styles.leaderboardLinkText}>View Leaderboard</Text>
          <ChevronRight size={14} color={theme.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bottomActions: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  challengeNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: theme.coral,
    paddingVertical: 14,
    borderRadius: borderRadius.lg,
  },
  challengeNowText: {
    ...typography.labelLarge,
    color: theme.white,
    fontWeight: '800',
  },
  leaderboardLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  leaderboardLinkText: {
    ...typography.bodyMedium,
    color: theme.textMuted,
    fontWeight: '600',
  },
});
