import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addReactionApi, removeReactionApi } from '@/services/api';
import { queryKeys } from '@/utils/queryKeys';

export function useReactions() {
  const queryClient = useQueryClient();

  const addReaction = useCallback(
    async (responseId: string, emoji: string) => {
      try {
        await addReactionApi(responseId, emoji);
      } catch {
        // If 409 conflict (already reacted), try removing instead (toggle behavior)
        try {
          await removeReactionApi(responseId, emoji);
        } catch {
          // Non-critical: reaction toggle is best-effort, UI updates optimistically
        }
      }
      queryClient.invalidateQueries({ queryKey: ['responses'] });
    },
    [queryClient],
  );

  return {
    addReaction,
  };
}
