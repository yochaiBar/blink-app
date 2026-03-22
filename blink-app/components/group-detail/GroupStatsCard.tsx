import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import { api } from '@/services/api';

interface GroupStatUser {
  user_id: string;
  display_name: string;
}

interface GroupStatsResponse {
  top_trigger: (GroupStatUser & { count: number }) | null;
  longest_streak: (GroupStatUser & { streak: number }) | null;
  fastest_responder: (GroupStatUser & { avg_ms: number }) | null;
  total_challenges: number;
  completion_rate: number;
}

interface GroupStatsCardProps {
  groupId: string;
}

function formatAvgTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export default function GroupStatsCard({ groupId }: GroupStatsCardProps) {
  const statsQuery = useQuery({
    queryKey: ['group-stats', groupId],
    queryFn: () => api<GroupStatsResponse>(`/groups/${groupId}/stats`),
    enabled: !!groupId,
    staleTime: 60_000,
    retry: false,
  });

  if (statsQuery.isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color={theme.textMuted} />
      </View>
    );
  }

  if (statsQuery.isError || !statsQuery.data) {
    return null;
  }

  const { top_trigger, longest_streak, fastest_responder, total_challenges } = statsQuery.data;

  // Don't show the card if there's no meaningful data yet
  if (total_challenges === 0 && !top_trigger && !longest_streak && !fastest_responder) {
    return null;
  }

  const stats = [
    top_trigger
      ? { emoji: '\u{1F525}', label: 'Top Trigger', value: `${top_trigger.count}`, name: top_trigger.display_name }
      : null,
    longest_streak && longest_streak.streak > 0
      ? { emoji: '\u{26A1}', label: 'Best Streak', value: `${longest_streak.streak}`, name: longest_streak.display_name }
      : null,
    fastest_responder
      ? { emoji: '\u{1F3C3}', label: 'Fastest', value: formatAvgTime(fastest_responder.avg_ms), name: fastest_responder.display_name }
      : null,
  ].filter(Boolean) as Array<{ emoji: string; label: string; value: string; name: string }>;

  if (stats.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {stats.map((stat, index) => (
          <View key={stat.label} style={[styles.statItem, index < stats.length - 1 && styles.statItemBorder]}>
            <Text style={styles.statEmoji}>{stat.emoji}</Text>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statName} numberOfLines={1}>{stat.name}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.bgCard,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.glassBorder,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  statItemBorder: {
    borderRightWidth: 1,
    borderRightColor: theme.glassBorder,
  },
  statEmoji: {
    fontSize: 18,
    marginBottom: spacing.xs,
  },
  statValue: {
    ...typography.statMedium,
    color: theme.text,
  },
  statName: {
    ...typography.bodySmall,
    color: theme.coral,
    fontWeight: '600',
    marginTop: 2,
    maxWidth: 80,
    textAlign: 'center',
  },
  statLabel: {
    ...typography.labelSmall,
    color: theme.textMuted,
    marginTop: 2,
  },
});
