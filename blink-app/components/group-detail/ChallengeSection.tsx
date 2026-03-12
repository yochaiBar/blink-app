import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Camera, Zap, Clock } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import GlassCard from '@/components/ui/GlassCard';
import BlinkAiAvatar from '@/components/BlinkAiAvatar';
import ActivityPulse from '@/components/ActivityPulse';
import { ApiChallenge } from '@/types/api';

export interface ChallengeTriggerInfo {
  isAi: boolean;
  name: string;
}

export interface ProgressData {
  responded: Array<{ userId: string; displayName: string; avatarUrl?: string }>;
  totalMembers: number;
}

export interface ChallengeSectionProps {
  activeChallenge: ApiChallenge;
  challengeTriggerInfo: ChallengeTriggerInfo | null;
  isQuizChallenge: boolean;
  hasSubmittedToday: boolean;
  countdown: string;
  pulseAnim: Animated.Value;
  progressData: ProgressData | null;
  currentUserId: string;
  onRespond: () => void;
  challengeBarRef: React.RefObject<View | null>;
}

export default function ChallengeSection({
  activeChallenge,
  challengeTriggerInfo,
  isQuizChallenge,
  hasSubmittedToday,
  countdown,
  pulseAnim,
  progressData,
  currentUserId,
  onRespond,
  challengeBarRef,
}: ChallengeSectionProps) {
  return (
    <View ref={challengeBarRef} collapsable={false}>
      <GlassCard style={styles.challengeCard} padding={spacing.lg}>
        {/* AI trigger label */}
        {challengeTriggerInfo?.isAi && (
          <View style={styles.aiTriggerRow}>
            <BlinkAiAvatar size={18} />
            <Text style={styles.aiTriggerText}>Blink AI</Text>
          </View>
        )}
        {!challengeTriggerInfo?.isAi && challengeTriggerInfo && (
          <Text style={styles.humanTriggerText}>
            {challengeTriggerInfo.name} started this
          </Text>
        )}

        {/* Challenge prompt */}
        <Text style={styles.challengePrompt}>
          {activeChallenge.prompt_text ?? activeChallenge.prompt ?? (
            isQuizChallenge ? 'Quiz time!' : 'Snap Challenge!'
          )}
        </Text>

        {/* Timer row */}
        {countdown ? (
          <View style={styles.timerRow}>
            <Animated.View style={[styles.timerDot, { opacity: pulseAnim }]} />
            <Text style={styles.timerText}>{countdown} remaining</Text>
          </View>
        ) : null}

        {/* Respond button OR ActivityPulse */}
        {!hasSubmittedToday ? (
          <TouchableOpacity
            style={styles.respondBtn}
            onPress={onRespond}
            activeOpacity={0.85}
            testID="snap-challenge-btn"
          >
            {isQuizChallenge ? (
              <Zap size={18} color={theme.white} />
            ) : (
              <Camera size={18} color={theme.white} />
            )}
            <Text style={styles.respondBtnText}>Respond</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.activityPulseInCard}>
            {progressData && (
              <ActivityPulse
                respondedUsers={progressData.responded}
                totalMembers={progressData.totalMembers}
                currentUserId={currentUserId}
                hasResponded={hasSubmittedToday}
              />
            )}
            <View style={styles.submittedInlineRow}>
              <Text style={styles.submittedInlineText}>You responded</Text>
              {countdown ? (
                <View style={styles.countdownBadge}>
                  <Clock size={11} color={theme.green} />
                  <Text style={styles.countdownBadgeText}>{countdown}</Text>
                </View>
              ) : null}
            </View>
          </View>
        )}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  challengeCard: {
    marginBottom: spacing.lg,
  },
  aiTriggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  aiTriggerText: {
    ...typography.labelSmall,
    color: theme.purple,
  },
  humanTriggerText: {
    ...typography.bodySmall,
    color: theme.textMuted,
    marginBottom: spacing.sm,
  },
  challengePrompt: {
    ...typography.headlineMedium,
    color: theme.text,
    marginBottom: spacing.md,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  timerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.coral,
  },
  timerText: {
    ...typography.bodySmall,
    color: theme.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  respondBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: theme.coral,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  respondBtnText: {
    ...typography.labelLarge,
    color: theme.white,
  },
  activityPulseInCard: {
    gap: spacing.sm,
  },
  submittedInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  submittedInlineText: {
    ...typography.bodySmall,
    color: theme.green,
    fontWeight: '600',
  },
  countdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.15)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  countdownBadgeText: {
    ...typography.bodySmall,
    color: theme.green,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});
