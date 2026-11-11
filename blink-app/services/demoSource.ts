/**
 * Data source for the onboarding demo group ("Welcome Crew").
 *
 * The demo group never touches the server. When a hook is asked for data
 * that belongs to it, the hook calls this module instead of the API, and gets
 * back the same shapes the API returns. Screens and components never check
 * for the demo group or import demo data themselves; the one thing they get is
 * the `isSample` flag the hooks return, for UI that a static sample can't
 * offer (group settings, streak/leaderboard actions, the tour tooltip).
 *
 * Every demo id starts with `demo_`, so a group, challenge or response id on
 * its own is enough to route to this source.
 */
import type { FeedItemData } from '@/components/FeedItem';
import { Group } from '@/types';
import { ApiChallenge, ApiChallengeResponse, ApiGroupDetail } from '@/types/api';
import {
  DEMO_CHALLENGE,
  DEMO_CHALLENGE_ID,
  DEMO_CHALLENGE_WINDOW_MS,
  DEMO_GROUP,
  DEMO_GROUP_DETAIL,
  DEMO_GROUP_ID,
  DEMO_ID_PREFIX,
  DEMO_OWN_RESPONSE_ID,
  DEMO_PHOTO_URIS,
  DEMO_RESPONSES,
} from '@/constants/demoData';
import { useOnboardingStore } from '@/stores/onboardingStore';

/** Who has answered a challenge (services/challengeReads progressOf). */
export interface ChallengeProgress {
  respondedCount: number;
  totalMembers: number;
  respondedUsers: { userId: string; displayName: string }[];
}

/** What the reveal screen renders: the responses plus the challenge they answer. */
export interface RevealData {
  responses: ApiChallengeResponse[];
  challenge: { id: string; prompt: string | null } | null;
  /** Hide others' photos: the challenge is open and you haven't answered it. */
  blurOthers?: boolean;
}

const isDemoId = (id: string | null | undefined): boolean => !!id && id.startsWith(DEMO_ID_PREFIX);

export function isDemoGroup(groupId: string | null | undefined): boolean {
  return groupId === DEMO_GROUP_ID;
}

export function isDemoChallenge(challengeId: string | null | undefined): boolean {
  return challengeId === DEMO_CHALLENGE_ID;
}

export function isDemoResponse(responseId: string | null | undefined): boolean {
  return isDemoId(responseId);
}

/** The demo challenge never expires: it always ends DEMO_CHALLENGE_WINDOW_MS from now. */
function activeChallenge(): ApiChallenge {
  return { ...DEMO_CHALLENGE, expires_at: new Date(Date.now() + DEMO_CHALLENGE_WINDOW_MS).toISOString() };
}

export const demoSource = {
  groupId: DEMO_GROUP_ID,
  challengeId: DEMO_CHALLENGE_ID,

  /** The demo group as it appears in the groups list. */
  listItem(): Group {
    return { ...DEMO_GROUP, challengeEndTime: Date.now() + DEMO_CHALLENGE_WINDOW_MS };
  },

  /** The demo group is listed until the user has a real group (or hides it); the tour doesn't end it. */
  isVisible({ realGroupCount }: { realGroupCount: number }): boolean {
    return realGroupCount === 0 && !useOnboardingStore.getState().demoDismissed;
  },

  /** Home's feed for a user with no real group: the demo challenge's card. */
  homeItems(): FeedItemData[] {
    const challenge = activeChallenge();
    return [
      {
        id: `cc_live_${DEMO_CHALLENGE_ID}`,
        type: 'challenge_card',
        groupId: DEMO_GROUP_ID,
        groupName: DEMO_GROUP.name,
        groupEmoji: DEMO_GROUP.emoji,
        challengeId: DEMO_CHALLENGE_ID,
        challengePrompt: challenge.prompt || undefined,
        isLive: true,
        expiresAt: challenge.expires_at,
        responseCount: DEMO_RESPONSES.length,
        memberCount: DEMO_GROUP_DETAIL.members.length,
        timestamp: challenge.created_at,
      },
    ];
  },

  /** GET /groups/:id */
  groupDetail(): ApiGroupDetail {
    return DEMO_GROUP_DETAIL;
  },

  /** GET /challenges/groups/:id/challenges/active */
  activeChallenge,

  /** GET /challenges/:id/responses (the other members' snaps). */
  responses(): ApiChallengeResponse[] {
    return DEMO_RESPONSES;
  },

  /** Who has answered the demo challenge. */
  progress(): ChallengeProgress {
    return {
      respondedCount: DEMO_RESPONSES.length,
      totalMembers: DEMO_GROUP_DETAIL.members.length,
      respondedUsers: DEMO_RESPONSES.map((r) => ({ userId: r.user_id, displayName: r.display_name ?? 'User' })),
    };
  },

  /** The reveal: the user's own snap first, then the demo crew's. */
  reveal(self: { id: string; name: string }): RevealData {
    const now = new Date().toISOString();
    const own: ApiChallengeResponse = {
      id: DEMO_OWN_RESPONSE_ID,
      challenge_id: DEMO_CHALLENGE_ID,
      user_id: self.id,
      display_name: self.name || 'You',
      has_photo: true,
      response_time_ms: 3200,
      responded_at: now,
      created_at: now,
    };
    return { responses: [own, ...DEMO_RESPONSES], challenge: activeChallenge() };
  },

  /** Image for a demo response: the photo the user just took, or a stock shot. */
  photoUri(responseId: string): string | null {
    if (responseId === DEMO_OWN_RESPONSE_ID) return useOnboardingStore.getState().demoPhotoUri;
    return DEMO_PHOTO_URIS[responseId] ?? null;
  },

  /** POST /respond: keep the user's snap on the device for their demo reveal. */
  recordSnap(photoUri?: string): void {
    if (photoUri) useOnboardingStore.getState().setDemoPhotoUri(photoUri);
  },

  /** The user saw the demo reveal: the demo challenge and the tour are done. */
  completeChallenge(): void {
    const store = useOnboardingStore.getState();
    store.completeDemoChallenge();
    store.completeTour();
  },
};
