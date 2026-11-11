/**
 * Reads behind the challenge screens: GET /challenges/:id, /feed and
 * /groups/:id/challenges (each with the responses the viewer may see).
 * Progress, preview and reveal data are derived from a challenge here
 * rather than fetched from routes of their own; socket events refresh them
 * (services/socketEvents), so nothing polls.
 *
 * The server no longer gates photos behind having played: hiding others'
 * photos on an open challenge you haven't answered is the client's job
 * (shouldBlurOthers).
 */

import { api } from '@/services/api';
import type { ChallengeProgress } from '@/services/demoSource';
import type { ApiChallengeDetail, ApiChallengeResponse, ApiChallengeSummary, ApiFeedPage } from '@/types/api';

/** Teaser numbers for a member who hasn't answered yet. */
export interface ChallengePreview {
  respondedCount: number;
  totalMembers: number;
  totalReactions: number;
  topReactionEmoji?: string;
  respondedUsers: { userId: string; displayName: string }[];
}

export function fetchChallenge(challengeId: string): Promise<ApiChallengeDetail> {
  return api<ApiChallengeDetail>(`/challenges/${challengeId}`);
}

export function fetchFeed(limit = 30): Promise<ApiFeedPage> {
  return api<ApiFeedPage>(`/feed?limit=${limit}`);
}

export function fetchGroupChallenges(groupId: string, limit = 10): Promise<ApiChallengeDetail[]> {
  return api<ApiChallengeDetail[]>(`/groups/${groupId}/challenges?limit=${limit}`);
}

const respondedUsers = (challenge: ApiChallengeDetail) =>
  challenge.responses.map((r) => ({ userId: r.user_id, displayName: r.display_name ?? 'New member' }));

export function progressOf(challenge: ApiChallengeDetail): ChallengeProgress {
  return {
    respondedCount: challenge.responses.length,
    totalMembers: challenge.member_count,
    respondedUsers: respondedUsers(challenge),
  };
}

/** Each emoji's total count across `responses`, most-used first. */
function rankReactions(responses: Pick<ApiChallengeResponse, 'reactions'>[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const r of responses) {
    for (const reaction of r.reactions ?? []) {
      totals.set(reaction.emoji, (totals.get(reaction.emoji) ?? 0) + reaction.count);
    }
  }
  return [...totals.entries()].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
}

/** The most-used reaction across `responses`; null when nobody reacted (never a made-up default). */
export function topReactionOf(responses: Pick<ApiChallengeResponse, 'reactions'>[]): string | null {
  return rankReactions(responses)[0]?.[0] ?? null;
}

export function previewOf(challenge: ApiChallengeDetail): ChallengePreview {
  const ranked = rankReactions(challenge.responses);
  return {
    respondedCount: challenge.responses.length,
    totalMembers: challenge.member_count,
    totalReactions: ranked.reduce((sum, [, count]) => sum + count, 0),
    topReactionEmoji: ranked[0]?.[0],
    respondedUsers: respondedUsers(challenge),
  };
}

/** Is this challenge still open for answers? */
export function isOpen(challenge: Pick<ApiChallengeSummary, 'status' | 'expires_at'>, now = Date.now()): boolean {
  return challenge.status === 'active' && new Date(challenge.expires_at).getTime() > now;
}

/** Others' photos stay blurred on an open challenge until you've answered it. */
export function shouldBlurOthers(
  challenge: Pick<ApiChallengeSummary, 'status' | 'expires_at' | 'user_has_responded'>,
  now = Date.now(),
): boolean {
  return isOpen(challenge, now) && !challenge.user_has_responded;
}
