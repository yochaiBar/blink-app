import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Platform, KeyboardAvoidingView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Send, MessageCircle } from 'lucide-react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import { PromptResponse } from '@/types';
import { getRelativeTime } from '@/utils/time';

export default function GroupPromptScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { groups, respondToPrompt, getPromptResponses, user } = useApp();

  const group = groups.find(g => g.id === groupId);
  const prompt = group?.activePrompt;
  const responses = getPromptResponses(prompt?.id ?? '');

  const [answer, setAnswer] = useState<string>('');
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const hasResponded = responses.some(r => r.userId === user.id);

  const handleSubmitResponse = useCallback(() => {
    if (!prompt) return;

    if (prompt.type === 'open' && !answer.trim()) return;
    if ((prompt.type === 'poll' || prompt.type === 'quiz') && selectedOption === null) return;

    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    const answerText = prompt.type === 'open'
      ? answer.trim()
      : prompt.options?.[selectedOption ?? 0] ?? '';

    respondToPrompt(prompt.id, answerText, selectedOption ?? undefined);
    setAnswer('');
    setSelectedOption(null);
  }, [prompt, answer, selectedOption, respondToPrompt]);

  const getOptionVotes = useCallback((optionIndex: number) => {
    return responses.filter(r => r.selectedOption === optionIndex).length;
  }, [responses]);

  const totalVotes = responses.filter(r => r.selectedOption !== undefined).length;

  const renderResponse = useCallback(({ item }: { item: PromptResponse }) => (
    <View style={styles.responseCard}>
      <Image source={{ uri: item.userAvatar }} style={styles.responseAvatar} contentFit="cover" />
      <View style={styles.responseContent}>
        <View style={styles.responseHeader}>
          <Text style={styles.responseName}>{item.userName}</Text>
          <Text style={styles.responseTime}>{getRelativeTime(item.timestamp)}</Text>
        </View>
        <Text style={styles.responseText}>{item.answer}</Text>
      </View>
    </View>
  ), []);

  if (!group || !prompt) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>Prompt not found</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.inner, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <MessageCircle size={18} color={theme.blue} />
            <Text style={styles.headerTitle}>Daily Prompt</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <View style={[styles.promptCard, { borderColor: `${group.color}40` }]}>
          <Text style={styles.promptQuestion}>{prompt.question}</Text>
          <View style={styles.promptMeta}>
            <Text style={styles.promptGroup}>{group.emoji} {group.name}</Text>
            <Text style={styles.promptDot}>·</Text>
            <Text style={styles.promptCount}>{responses.length} responses</Text>
          </View>
        </View>

        {prompt.type !== 'open' && prompt.options && (
          <View style={styles.optionsContainer}>
            {prompt.options.map((option, i) => {
              const votes = getOptionVotes(i);
              const percentage = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
              const isSelected = selectedOption === i;
              const isCorrect = prompt.type === 'quiz' && prompt.correctAnswer === i && hasResponded;

              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.optionBtn,
                    isSelected && { borderColor: group.color },
                    isCorrect && { borderColor: theme.green },
                  ]}
                  onPress={() => {
                    if (!hasResponded) {
                      setSelectedOption(i);
                      if (Platform.OS !== 'web') {
                        Haptics.selectionAsync();
                      }
                    }
                  }}
                  disabled={hasResponded}
                  activeOpacity={0.8}
                >
                  {hasResponded && (
                    <View
                      style={[
                        styles.optionFill,
                        { width: `${percentage}%`, backgroundColor: isCorrect ? `${theme.green}20` : `${group.color}15` },
                      ]}
                    />
                  )}
                  <Text style={[styles.optionText, isSelected && { color: group.color }]}>{option}</Text>
                  {hasResponded && (
                    <Text style={styles.optionPercent}>{Math.round(percentage)}%</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <FlatList
          data={responses}
          renderItem={renderResponse}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.responsesList}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            responses.length > 0 ? (
              <Text style={styles.responsesTitle}>Responses</Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyText}>Be the first to respond!</Text>
            </View>
          }
        />

        {!hasResponded && prompt.type === 'open' && (
          <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
            <TextInput
              style={styles.inputField}
              value={answer}
              onChangeText={setAnswer}
              placeholder="Type your answer..."
              placeholderTextColor={theme.textMuted}
              maxLength={200}
              testID="prompt-answer-input"
            />
            <TouchableOpacity
              style={[styles.sendBtn, !answer.trim() && styles.sendBtnDisabled]}
              onPress={handleSubmitResponse}
              disabled={!answer.trim()}
            >
              <Send size={18} color={answer.trim() ? theme.white : theme.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {!hasResponded && prompt.type !== 'open' && selectedOption !== null && (
          <View style={[styles.submitBar, { paddingBottom: insets.bottom + 8 }]}>
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: group.color }]}
              onPress={handleSubmitResponse}
              activeOpacity={0.85}
            >
              <Text style={styles.submitBtnText}>Submit Answer</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  inner: {
    flex: 1,
  },
  errorText: {
    fontSize: 16,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: theme.text,
  },
  promptCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 20,
    backgroundColor: theme.bgCard,
    borderRadius: 18,
    borderWidth: 1.5,
  },
  promptQuestion: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: theme.text,
    lineHeight: 28,
    marginBottom: 12,
  },
  promptMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  promptGroup: {
    fontSize: 13,
    color: theme.textSecondary,
    fontWeight: '600' as const,
  },
  promptDot: {
    fontSize: 13,
    color: theme.textMuted,
  },
  promptCount: {
    fontSize: 13,
    color: theme.textMuted,
  },
  optionsContainer: {
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 16,
  },
  optionBtn: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  optionFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 14,
  },
  optionText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: theme.text,
    zIndex: 1,
  },
  optionPercent: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: theme.textSecondary,
    zIndex: 1,
  },
  responsesList: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  responsesTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: theme.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 12,
    marginTop: 4,
  },
  responseCard: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
  },
  responseAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  responseContent: {
    flex: 1,
  },
  responseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  responseName: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: theme.text,
  },
  responseTime: {
    fontSize: 12,
    color: theme.textMuted,
  },
  responseText: {
    fontSize: 14,
    color: theme.textSecondary,
    lineHeight: 20,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 40,
    gap: 8,
  },
  emptyEmoji: {
    fontSize: 36,
  },
  emptyText: {
    fontSize: 15,
    color: theme.textMuted,
    fontWeight: '500' as const,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 10,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    backgroundColor: theme.bg,
  },
  inputField: {
    flex: 1,
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: theme.surface,
  },
  submitBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    backgroundColor: theme.bg,
  },
  submitBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitBtnText: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: theme.white,
  },
});
