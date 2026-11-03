// Backend API response types matching the real server

export interface ApiUser {
  id: string;
  phone_number: string;
  display_name: string | null;
  avatar_url: string | null;
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
  avatar_url: string | null;
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
  avatar_url: string | null;
  /** v1 only; null for v2 responses (Phase 6 cutover). Dropped in migration 015. */
  photo_url: string | null;
  /** True for both v1 + v2 photo responses. Added in migration 014. */
  has_photo?: boolean;
  response_time_ms: number | null;
  responded_at: string;
  created_at: string;
  reactions?: ApiReaction[];
}

export interface EncryptionMetadata {
  v: number;
  alg: string;
  iv: string;
  tag: string;
  key_enc: string;
}
