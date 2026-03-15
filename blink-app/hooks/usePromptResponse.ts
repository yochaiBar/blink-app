import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { PromptResponse, UserProfile } from '@/types';
import { api } from '@/services/api';
import { queryKeys } from '@/utils/queryKeys';

export function usePromptResponse(user: UserProfile) {
  const queryClient = useQueryClient();
  const [promptResponses, setPromptResponses] = useState<PromptResponse[]>([]);

  const respondToPrompt = useCallback(
    async (promptId: string, answer: string, selectedOption?: number) => {
      const newResponse: PromptResponse = {
        id: `resp_${Date.now()}`,
        promptId,
        userId: user.id,
        userName: user.name?.split(' ')[0] || 'You',
        userAvatar: user.avatar,
        answer,
        selectedOption,
        timestamp: new Date().toISOString(),
      };
      setPromptResponses((prev) => [newResponse, ...prev]);

      try {
        await api(`/challenges/${promptId}/respond`, {
          method: 'POST',
          body: JSON.stringify({
            answer_text: answer,
            ...(selectedOption !== undefined ? { answer_index: selectedOption } : {}),
          }),
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.challenges.responses(promptId) });
      } catch {
        Alert.alert('Error', 'Could not submit your response. Please try again.');
      }
    },
    [user, queryClient],
  );

  const getPromptResponses = useCallback(
    (promptId: string) => {
      return promptResponses.filter((r) => r.promptId === promptId);
    },
    [promptResponses],
  );

  return {
    respondToPrompt,
    getPromptResponses,
  };
}
