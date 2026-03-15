import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, uploadPhoto } from '@/services/api';
import { isDemoGroup } from '@/constants/demoData';
import { ApiChallenge } from '@/types/api';
import { queryKeys } from '@/utils/queryKeys';

export function useSubmitSnap() {
  const queryClient = useQueryClient();

  const snapMutation = useMutation({
    mutationFn: async ({ groupId, imageUri }: { groupId: string; imageUri?: string }) => {
      // Skip API calls for demo group
      if (isDemoGroup(groupId)) return;

      // Find active challenge for this group
      let challengeId: string | null = null;
      try {
        const challenge: ApiChallenge = await api(`/challenges/groups/${groupId}/challenges/active`);
        challengeId = challenge.id;
      } catch {
        // No active challenge found for this group -- not an error
      }

      if (!challengeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
        return;
      }

      const body: Record<string, unknown> = {};
      if (imageUri) {
        const photoUrl = await uploadPhoto(imageUri, groupId, challengeId);
        body.photo_url = photoUrl;
      }
      body.response_time_ms = 5000;

      return api(`/challenges/${challengeId}/respond`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
      queryClient.invalidateQueries({ queryKey: ['responses'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.user.stats });
    },
    onError: (error: Error) => {
      Alert.alert('Snap Failed', error.message || 'Could not submit your snap. Please try again.');
    },
  });

  const submitSnap = useCallback(
    async (groupId: string, imageUri?: string) => {
      await snapMutation.mutateAsync({ groupId, imageUri });
    },
    [snapMutation],
  );

  return {
    submitSnap,
    isSubmitting: snapMutation.isPending,
  };
}
