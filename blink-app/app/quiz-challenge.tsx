import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Check, Users } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useQuery, useMutation } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { api } from '@/services/api';
import { Button } from '@/components/ui';
import { ApiChallengeResponse } from '@/types/api';

interface ResponseResult {
  id: string;
  challenge_id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  answer_index: number | null;
  created_at: string;
}

type Phase = 'answering' | 'submitting' | 'results';

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop';

export default function QuizChallengeScreen() {
  const params = useLocalSearchParams<{
    groupId: string;
    challengeId: string;
    type: string;
    promptText: string;
    optionsJson: string;
    expiresAt: string;
  }>();
  const {
    groupId,
    challengeId,
    type,
    promptText,
    optionsJson,
    expiresAt,
  } = params;

  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('answering');
  const [countdown, setCountdown] = useState<string>('');

  const options: string[] = useMemo(() => {
    try {
      return JSON.parse(optionsJson ?? '[]');
    } catch {
      // Malformed JSON from params -- fall back to empty options
      return [];
    }
  }, [optionsJson]);

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return;
    const update = () => {
      const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      if (remaining === 0) {
        setCountdown('Expired');
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${mins}:${secs.toString().padStart(2, '0')}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Fetch results after submission
  const resultsQuery = useQuery({
    queryKey: ['quiz-results', challengeId],
    queryFn: async (): Promise<ResponseResult[]> => {
      const data: ApiChallengeResponse[] = await api(`/challenges/${challengeId}/responses`);
      return data as unknown as ResponseResult[];
    },
    enabled: phase === 'results',
  });

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async (answerIndex: number) => {
      return api(`/challenges/${challengeId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ answer_index: answerIndex }),
      });
    },
    onSuccess: () => {
      setPhase('results');
    },
    onError: (error: Error) => {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      // If already responded, go to results
      if (error.message?.toLowerCase().includes('already')) {
        setPhase('results');
      }
    },
  });

  const handleSelect = useCallback((index: number) => {
    if (phase !== 'answering') return;
    setSelectedIndex(index);
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
  }, [phase]);

  const handleSubmit = useCallback(() => {
    if (selectedIndex === null) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    setPhase('submitting');
    submitMutation.mutate(selectedIndex);
  }, [selectedIndex, submitMutation]);

  // Compute results distribution
  const resultDistribution = useMemo(() => {
    if (!resultsQuery.data) return [];
    const counts = options.map(() => 0);
    const respondents: Record<number, { name: string; avatar: string }[]> = {};
    for (const r of resultsQuery.data) {
      if (r.answer_index !== null && r.answer_index < counts.length) {
        counts[r.answer_index]++;
        if (!respondents[r.answer_index]) respondents[r.answer_index] = [];
        respondents[r.answer_index].push({
          name: r.display_name ?? 'User',
          avatar: r.avatar_url ?? DEFAULT_AVATAR,
        });
      }
    }
    const total = counts.reduce((a, b) => a + b, 0);
    return options.map((opt, i) => ({
      label: opt,
      count: counts[i],
      percentage: total > 0 ? Math.round((counts[i] / total) * 100) : 0,
      respondents: respondents[i] ?? [],
    }));
  }, [resultsQuery.data, options]);

  const totalResponses = resultsQuery.data?.length ?? 0;
  const mostPopularIndex = resultDistribution.length > 0
    ? resultDistribution.reduce((maxI, item, i, arr) => item.count > arr[maxI].count ? i : maxI, 0)
    : -1;

  const challengeEmoji = type?.includes('food') ? '🍔' : type?.includes('most_likely') ? '👀' : '🧠';
  const challengeLabel = type?.includes('food') ? 'FOOD QUIZ' : type?.includes('most_likely') ? 'MOST LIKELY TO' : 'QUIZ CHALLENGE';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => router.back()}
        >
          <X size={22} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.challengeLabel}>{challengeEmoji} {challengeLabel}</Text>
        </View>

        <View style={styles.timerBadge}>
          <Text style={styles.timerText}>{countdown}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Question */}
        <View style={styles.questionCard}>
          <Text style={styles.questionText}>{promptText}</Text>
        </View>

        {/* Answering & Submitting Phase */}
        {(phase === 'answering' || phase === 'submitting') && (
          <View style={styles.optionsList}>
            {options.map((option, i) => {
              const isSelected = selectedIndex === i;
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.optionCard,
                    isSelected && styles.optionCardSelected,
                  ]}
                  onPress={() => handleSelect(i)}
                  activeOpacity={0.8}
                  disabled={phase === 'submitting'}
                >
                  <View style={[styles.optionIndex, isSelected && styles.optionIndexSelected]}>
                    {isSelected ? (
                      <Check size={14} color={theme.white} />
                    ) : (
                      <Text style={styles.optionIndexText}>{String.fromCharCode(65 + i)}</Text>
                    )}
                  </View>
                  <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Results Phase */}
        {phase === 'results' && (
          <View style={styles.resultsContainer}>
            <View style={styles.resultsHeader}>
              <Users size={18} color={theme.textSecondary} />
              <Text style={styles.resultsTitle}>
                {totalResponses} {totalResponses === 1 ? 'response' : 'responses'}
              </Text>
            </View>

            {resultsQuery.isLoading && (
              <ActivityIndicator size="large" color={theme.coral} style={{ marginTop: 20 }} />
            )}

            {resultDistribution.map((item, i) => {
              const isMostPopular = i === mostPopularIndex && totalResponses > 0;
              const isMyPick = i === selectedIndex;

              return (
                <View key={i} style={styles.resultRow}>
                  <View style={styles.resultHeader}>
                    <View style={styles.resultLabelRow}>
                      <Text style={[styles.resultLabel, isMostPopular && styles.resultLabelPopular]}>
                        {item.label}
                      </Text>
                      {isMostPopular && (
                        <View style={styles.popularBadge}>
                          <Text style={styles.popularBadgeText}>Most Popular</Text>
                        </View>
                      )}
                      {isMyPick && (
                        <View style={styles.myPickBadge}>
                          <Text style={styles.myPickBadgeText}>Your pick</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.resultPercent}>{item.percentage}%</Text>
                  </View>

                  {/* Progress bar */}
                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${item.percentage}%`,
                          backgroundColor: isMostPopular ? theme.coral : theme.surfaceLight,
                        },
                      ]}
                    />
                  </View>

                  {/* Avatars */}
                  {item.respondents.length > 0 && (
                    <View style={styles.respondentsRow}>
                      {item.respondents.slice(0, 5).map((r, ri) => (
                        <Image
                          key={ri}
                          source={{ uri: r.avatar }}
                          style={[styles.respondentAvatar, { marginLeft: ri > 0 ? -6 : 0, zIndex: 5 - ri }]}
                          contentFit="cover"
                        />
                      ))}
                      {item.respondents.length > 5 && (
                        <Text style={styles.moreRespondents}>+{item.respondents.length - 5}</Text>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Bottom action bar */}
      {phase === 'answering' && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
          <Button
            title="Submit"
            onPress={handleSubmit}
            variant="primary"
            size="lg"
            fullWidth
            disabled={selectedIndex === null}
          />
        </View>
      )}

      {phase === 'submitting' && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
          <Button
            title="Submitting..."
            onPress={() => {}}
            variant="primary"
            size="lg"
            fullWidth
            loading
          />
        </View>
      )}

      {phase === 'results' && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
          <Button
            title="See Responses"
            onPress={() => {
              if (challengeId && groupId) {
                router.replace({
                  pathname: '/challenge-reveal' as never,
                  params: { challengeId, groupId },
                });
              } else {
                router.back();
              }
            }}
            variant="primary"
            size="lg"
            fullWidth
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  challengeLabel: {
    ...typography.label,
    color: theme.coral,
    letterSpacing: 2,
  },
  timerBadge: {
    backgroundColor: theme.coralMuted,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  timerText: {
    ...typography.bodyBold,
    color: theme.coral,
    fontVariant: ['tabular-nums'],
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  questionCard: {
    backgroundColor: theme.bgCard,
    borderRadius: 18,
    padding: 24,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: theme.border,
  },
  questionText: {
    ...typography.h2,
    color: theme.text,
    lineHeight: 30,
  },
  optionsList: {
    gap: 10,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1.5,
    borderColor: theme.border,
  },
  optionCardSelected: {
    borderColor: theme.coral,
    backgroundColor: theme.coralMuted,
  },
  optionIndex: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionIndexSelected: {
    backgroundColor: theme.coral,
  },
  optionIndexText: {
    ...typography.bodyBold,
    color: theme.textSecondary,
  },
  optionText: {
    ...typography.body,
    color: theme.text,
    flex: 1,
  },
  optionTextSelected: {
    color: theme.coral,
    fontWeight: '700',
  },
  // Results
  resultsContainer: {
    gap: 16,
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  resultsTitle: {
    ...typography.bodyBold,
    color: theme.textSecondary,
  },
  resultRow: {
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  resultLabelRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  resultLabel: {
    ...typography.bodyBold,
    color: theme.text,
  },
  resultLabelPopular: {
    color: theme.coral,
  },
  resultPercent: {
    ...typography.h4,
    color: theme.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  popularBadge: {
    backgroundColor: theme.coralMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  popularBadgeText: {
    ...typography.small,
    color: theme.coral,
    fontWeight: '700',
  },
  myPickBadge: {
    backgroundColor: theme.blueMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  myPickBadgeText: {
    ...typography.small,
    color: theme.blue,
    fontWeight: '700',
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  respondentsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  respondentAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.bgCard,
  },
  moreRespondents: {
    ...typography.caption,
    color: theme.textMuted,
    marginLeft: 6,
  },
  // Bottom bar
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    backgroundColor: theme.bg,
  },
});
