/**
 * Centralized query key factory for React Query.
 *
 * Every query key used in the app should be defined here to avoid
 * typo-related cache misses and to make invalidation predictable.
 */
export const queryKeys = {
  groups: {
    all: ['groups'] as const,
    detail: (id: string) => ['group', id] as const,
  },
  challenges: {
    active: (groupId: string) => ['challenge', groupId] as const,
    activeForSnap: (groupId: string, challengeId?: string) =>
      ['active-challenge', groupId, challengeId] as const,
    responses: (challengeId: string | undefined) => ['responses', challengeId] as const,
    history: (groupId: string) => ['challenge-history', groupId] as const,
    progress: (challengeId: string | undefined) => ['challenge-progress', challengeId] as const,
    reveal: (challengeId: string) => ['challenge-reveal', challengeId] as const,
    quizResults: (challengeId: string) => ['quiz-results', challengeId] as const,
  },
  feed: {
    activeChallenges: (groupIds: string) => ['feed-active-challenges', groupIds] as const,
    blinks: (groupIds: string) => ['blinks-feed-v2', groupIds] as const,
  },
  activity: {
    all: ['activity'] as const,
  },
  notifications: {
    all: ['notifications'] as const,
  },
  user: {
    stats: ['userStats'] as const,
    profile: ['userProfile'] as const,
  },
  spotlight: {
    detail: (groupId: string) => ['spotlight', groupId] as const,
  },
  photos: {
    group: (groupId: string) => ['group-photos', groupId] as const,
  },
  groupDetailReveal: {
    detail: (groupId: string) => ['group-detail-reveal', groupId] as const,
  },
} as const;
