import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, addReactionApi, removeReactionApi } from '@/services/api';
import { isDemoResponse } from '@/services/demoSource';

export function useReactions() {
  const queryClient = useQueryClient();

  const addReaction = useCallback(
    async (responseId: string, emoji: string) => {
      // Demo responses only exist on this device; the reveal shows the tap locally.
      if (isDemoResponse(responseId)) return;
      try {
        await addReactionApi(responseId, emoji);
      } catch (err) {
        // 409: already reacted with this emoji — tapping again removes it.
        if (err instanceof ApiError && err.status === 409) {
          await removeReactionApi(responseId, emoji).catch(() => undefined);
        }
        // Anything else: best-effort, the next refetch shows the truth.
      }
      queryClient.invalidateQueries({ queryKey: ['responses'] });
    },
    [queryClient],
  );

  return {
    addReaction,
  };
}
