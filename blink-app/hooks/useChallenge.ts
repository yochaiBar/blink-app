import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import {
  demoSource,
  isDemoChallenge,
  isDemoGroup,
  type ChallengeProgress,
  type RevealData,
} from '@/services/demoSource';
import { fetchChallenge, progressOf, shouldBlurOthers } from '@/services/challengeReads';
import { ApiChallenge, ApiGroupDetail } from '@/types/api';

/** The challenge being answered on the snap screen. */
export function useActiveChallenge(groupId: string | undefined, challengeId?: string) {
  return useQuery({
    queryKey: ['active-challenge', groupId, challengeId],
    queryFn: async (): Promise<ApiChallenge> => {
      if (isDemoGroup(groupId)) return demoSource.activeChallenge();
      if (challengeId) return api<ApiChallenge>(`/challenges/${challengeId}`);
      return api<ApiChallenge>(`/challenges/groups/${groupId}/challenges/active`);
    },
    enabled: !!groupId,
    staleTime: 60_000,
  });
}

/** Who has answered so far; challenge:response events refresh it (services/socketEvents). */
export function useChallengeProgress(challengeId: string | undefined, enabled: boolean) {
  const isSample = isDemoChallenge(challengeId);
  return useQuery({
    queryKey: ['challenge-progress', challengeId],
    queryFn: async (): Promise<ChallengeProgress> =>
      isSample ? demoSource.progress() : progressOf(await fetchChallenge(challengeId!)),
    enabled: !!challengeId && enabled,
  });
}

/**
 * Data for the reveal screen. `markSeen` is called once the summary shows;
 * for the demo group that finishes the onboarding demo and tour.
 */
export function useChallengeReveal(
  challengeId: string | undefined,
  groupId: string | undefined,
  self: { id: string; name: string },
) {
  const isSample = isDemoGroup(groupId);

  // No polling: a new response (challenge:response) and a photo arriving
  // (photo:incoming → localPhoto) both refresh what this screen shows.
  const revealQuery = useQuery<RevealData>({
    queryKey: ['challenge-reveal', challengeId],
    queryFn: async (): Promise<RevealData> => {
      if (isSample) return demoSource.reveal(self);
      const challenge = await fetchChallenge(challengeId!);
      return {
        responses: challenge.responses,
        challenge: { id: challenge.id, prompt: challenge.prompt },
        blurOthers: shouldBlurOthers(challenge),
      };
    },
    enabled: !!challengeId,
    staleTime: 60_000,
  });

  const groupQuery = useQuery<ApiGroupDetail>({
    queryKey: ['group-detail-reveal', groupId],
    queryFn: async () => (isSample ? demoSource.groupDetail() : api<ApiGroupDetail>(`/groups/${groupId}`)),
    enabled: !!groupId,
    staleTime: 60_000,
  });

  const markSeen = useCallback(() => {
    if (isSample) demoSource.completeChallenge();
  }, [isSample]);

  return { isSample, revealQuery, groupQuery, markSeen };
}
