import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Users } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import GlassCard from '@/components/ui/GlassCard';

export interface QuizDistributionItem {
  label: string;
  count: number;
  percentage: number;
  respondents: { name: string; avatar: string }[];
}

export interface QuizResultsSectionProps {
  promptText: string;
  totalResponses: number;
  distribution: QuizDistributionItem[];
  currentUserId: string;
  myAnswerIndex: number | null | undefined;
}

export default function QuizResultsSection({
  promptText,
  totalResponses,
  distribution,
  myAnswerIndex,
}: QuizResultsSectionProps) {
  return (
    <View style={styles.quizResultsContainer}>
      <GlassCard style={styles.quizHeaderCard}>
        <Text style={[typography.headlineMedium, { color: theme.text }]}>
          {promptText}
        </Text>
        <View style={styles.quizResponseCount}>
          <Users size={14} color={theme.textMuted} />
          <Text style={styles.quizResponseCountText}>
            {totalResponses} {totalResponses === 1 ? 'response' : 'responses'}
          </Text>
        </View>
      </GlassCard>
      {distribution.map((item, i) => {
        const isTopAnswer = distribution.every((d) => item.count >= d.count) && item.count > 0;
        const isMyPick = myAnswerIndex === i;
        return (
          <View key={i} style={styles.quizResultRow}>
            <View style={styles.quizResultHeader}>
              <View style={styles.quizResultLabelRow}>
                <Text style={[styles.quizResultLabel, isTopAnswer && { color: theme.coral }]}>
                  {item.label}
                </Text>
                {isMyPick && (
                  <View style={styles.quizMyPickBadge}>
                    <Text style={styles.quizMyPickText}>You</Text>
                  </View>
                )}
              </View>
              <Text style={styles.quizResultPercent}>{item.percentage}%</Text>
            </View>
            <View style={styles.quizProgressBg}>
              <View style={[
                styles.quizProgressFill,
                { width: `${item.percentage}%`, backgroundColor: isTopAnswer ? theme.coral : theme.surfaceLight },
              ]} />
            </View>
            {item.respondents.length > 0 && (
              <View style={styles.quizRespondentsRow}>
                {item.respondents.slice(0, 5).map((r, ri) => (
                  <Image
                    key={ri}
                    source={{ uri: r.avatar }}
                    style={[styles.quizRespondentAvatar, { marginLeft: ri > 0 ? -6 : 0, zIndex: 5 - ri }]}
                    contentFit="cover"
                  />
                ))}
                {item.respondents.length > 5 && (
                  <Text style={styles.quizMoreRespondents}>+{item.respondents.length - 5}</Text>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  quizResultsContainer: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  quizHeaderCard: {
    marginBottom: spacing.xs,
  },
  quizResponseCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quizResponseCountText: {
    ...typography.bodySmall,
    color: theme.textMuted,
    fontWeight: '600',
  },
  quizResultRow: {
    backgroundColor: theme.bgCard,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  quizResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quizResultLabelRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  quizResultLabel: {
    ...typography.bodyLarge,
    fontWeight: '700',
    color: theme.text,
  },
  quizResultPercent: {
    ...typography.headlineMedium,
    color: theme.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  quizMyPickBadge: {
    backgroundColor: theme.blueMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  quizMyPickText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.blue,
  },
  quizProgressBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  quizProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  quizRespondentsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quizRespondentAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.bgCard,
  },
  quizMoreRespondents: {
    ...typography.bodySmall,
    color: theme.textMuted,
    marginLeft: 6,
  },
});
