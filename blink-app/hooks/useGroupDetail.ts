import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { demoSource, isDemoChallenge, isDemoGroup, type ChallengeProgress } from '@/services/demoSource';
import { fetchChallenge, previewOf, progressOf, type ChallengePreview } from '@/services/challengeReads';
import { ApiChallenge, ApiChallengeResponse, ApiGroupDetail } from '@/types/api';

export type { ChallengePreview };

/**
 * Everything the group detail screen reads: the group, its active challenge,
 * that challenge's responses and the group's photo count. The demo group is
 * served by demoSource; `isSample` tells the screen it is showing that static
 * sample rather than a real group.
 */
export function useGroupDetail(groupId: string | undefined) {
  const isSample = isDemoGroup(groupId);

  const groupQuery = useQuery({
    queryKey: ['group', groupId],
    queryFn: async (): Promise<ApiGroupDetail> =>
      isSample ? demoSource.groupDetail() : api<ApiGroupDetail>(`/groups/${groupId}`),
    enabled: !!groupId,
    staleTime: isSample ? Infinity : 15_000,
  });

  const challengeQuery = useQuery({
    queryKey: ['challenge', groupId],
    queryFn: async (): Promise<ApiChallenge> =>
      isSample ? demoSource.activeChallenge() : api<ApiChallenge>(`/challenges/groups/${groupId}/challenges/active`),
    enabled: !!groupId,
    retry: false,
    staleTime: isSample ? Infinity : undefined,
  });

  const activeChallenge = challengeQuery.data ?? null;

  const responsesQuery = useQuery({
    queryKey: ['responses', activeChallenge?.id],
    queryFn: async (): Promise<ApiChallengeResponse[]> =>
      isDemoChallenge(activeChallenge?.id)
        ? demoSource.responses()
        : (await fetchChallenge(activeChallenge!.id)).responses,
    enabled: !!activeChallenge?.id,
    staleTime: isSample ? Infinity : undefined,
  });

  const photosQuery = useQuery({
    queryKey: ['group-photos', groupId],
    queryFn: async (): Promise<{ id: string }[]> =>
      isSample ? [] : ((await api<{ id: string }[]>(`/challenges/groups/${groupId}/photos?limit=30`)) ?? []),
    enabled: !!groupId,
    staleTime: 60_000,
    retry: false,
  });

  return { isSample, groupQuery, challengeQuery, activeChallenge, responsesQuery, photosQuery };
}

/** Who has answered the challenge so far; null when there is nothing to fetch. */
export async function fetchChallengeProgress(challengeId: string): Promise<ChallengeProgress | null> {
  if (isDemoChallenge(challengeId)) return null;
  return progressOf(await fetchChallenge(challengeId));
}

/** Teaser numbers for members who haven't answered yet; null when there is nothing to fetch. */
export async function fetchChallengePreview(challengeId: string): Promise<ChallengePreview | null> {
  if (isDemoChallenge(challengeId)) return null;
  return previewOf(await fetchChallenge(challengeId));
}
