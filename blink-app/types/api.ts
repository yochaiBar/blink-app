// Backend API response types matching the real server

export interface ApiUser {
  id: string;
  phone_number: string;
  display_name: string | null;
  bio: string | null;
}

export interface ApiGroupListItem {
  id: string;
  name: string;
  icon: string;
  invite_code: string;
  member_count: number;
  role: string;
  has_active_challenge?: boolean;
  challenge_expires_at?: string;
  group_key_version?: number;
}

export interface ApiGroupMember {
  user_id: string;
  display_name: string | null;
  role: string;
  streak: number;
  participation_rate: number;
  total_responses: number;
  joined_at: string;
}

export interface ApiGroupDetail {
  id: string;
  name: string;
  icon: string;
  invite_code: string;
  created_by: string;
  created_at: string;
  /** Consecutive challenges everyone answered, and the record (kept by the server's finalize). */
  group_streak?: number;
  longest_group_streak?: number;
  members: ApiGroupMember[];
}

/** Every challenge is a photo snap; there is no challenge type. */
export interface ApiChallenge {
  id: string;
  group_id: string;
  prompt: string | null;
  /** Member who started it; null for scheduled challenges. */
  created_by: string | null;
  created_at: string;
  expires_at: string;
  status: 'active' | 'completed' | 'expired';
  user_has_responded?: boolean;
}

export interface ApiReaction {
  emoji: string;
  count: number;
  user_ids?: string[];
}

export interface ApiChallengeResponse {
  id: string;
  challenge_id: string;
  user_id: string;
  display_name: string | null;
  /** The photo itself never touches the server: it arrives over the E2E relay into the local photo store. */
  has_photo?: boolean;
  response_time_ms: number | null;
  responded_at: string;
  created_at?: string;
  reactions?: ApiReaction[];
  comment_count?: number;
}

/** A challenge as GET /feed, /groups/:id/challenges and /challenges/:id list it. */
export interface ApiChallengeSummary extends ApiChallenge {
  group_name: string;
  group_emoji: string;
  member_count: number;
  response_count: number;
  user_has_responded: boolean;
}

/** …with its responses the viewer may see (blocks filtered server-side). */
export interface ApiChallengeDetail extends ApiChallengeSummary {
  responses: ApiChallengeResponse[];
}

/** GET /feed — pass `next_before` back as `before` for the next page. */
export interface ApiFeedPage {
  items: ApiChallengeDetail[];
  next_before: string | null;
}
