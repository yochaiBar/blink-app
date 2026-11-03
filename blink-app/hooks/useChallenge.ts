import { useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import {
  demoSource,
  isDemoChallenge,
  isDemoGroup,
  type ChallengeProgress,
  type RevealData,
} from '@/services/demoSource';
import { ApiChallenge, ApiChallengeResponse, ApiGroupDetail } from '@/types/api';

/** GET /challenges/:id/reveal (camelCase, unlike the rest of the API). */
interface RevealPayload {
  challenge?: { id: string; prompt: string | null; groupName?: string; groupEmoji?: string } | null;
  responses?: {
    id: string;
    userId: string;
    displayName: string | null;
    hasPhoto: boolean;
    responseTimeMs: number | null;
    respondedAt: string;
    reactions?: { emoji: string; count: number }[];
  }[];
}

function revealResponseToResponse(
  r: NonNullable<RevealPayload['responses']>[number],
  challengeId: string,
): ApiChallengeResponse {
  return {
    id: r.id,
    challenge_id: challengeId,
    user_id: r.userId,
    display_name: r.displayName,
    has_photo: r.hasPhoto,
    response_time_ms: r.responseTimeMs,
    responded_at: r.respondedAt,
    created_at: r.respondedAt,
    reactions: r.reactions,
  };
}

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

/** Who has answered so far; polls every 5s for real challenges. */
export function useChallengeProgress(challengeId: string | undefined, enabled: boolean) {
  const isSample = isDemoChallenge(challengeId);
  return useQuery({
    queryKey: ['challenge-progress', challengeId],
    queryFn: async (): Promise<ChallengeProgress> =>
      isSample ? demoSource.progress() : api<ChallengeProgress>(`/challenges/${challengeId}/progress`),
    enabled: !!challengeId && enabled,
    refetchInterval: isSample ? false : 5000,
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
  // Stop refetching 10s after the screen opened.
  const mountedAt = useRef(Date.now()).current;

  const revealQuery = useQuery<RevealData>({
    queryKey: ['challenge-reveal', challengeId],
    queryFn: async (): Promise<RevealData> => {
      if (isSample) return demoSource.reveal(self);

      // Try reveal endpoint first
      try {
        const res = await api<RevealPayload>(`/challenges/${challengeId}/reveal`);
        return {
          responses: (res.responses ?? []).map((r) => revealResponseToResponse(r, challengeId ?? '')),
          challenge: res.challenge ? { id: res.challenge.id, prompt: res.challenge.prompt } : null,
        };
      } catch {
        // Reveal endpoint may not exist yet -- fall back to responses endpoint
        const responses: ApiChallengeResponse[] = await api(`/challenges/${challengeId}/responses`);
        return { responses: Array.isArray(responses) ? responses : [], challenge: null };
      }
    },
    enabled: !!challengeId,
    staleTime: 60_000,
    // Refetch every 3s for the first 10s while any response is still without a photo
    refetchInterval: isSample
      ? false
      : (query) => {
          const elapsed = Date.now() - mountedAt;
          if (elapsed > 10_000) return false;
          const responses = query.state.data?.responses ?? [];
          const hasMissingPhoto = responses.some((r: ApiChallengeResponse) => !r.has_photo);
          return hasMissingPhoto ? 3000 : false;
        },
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
