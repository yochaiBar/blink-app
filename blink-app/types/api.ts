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
  category: string;
  invite_code: string;
  member_count: number;
  role: string;
  skip_penalty_type: string;
  has_active_challenge?: boolean;
  challenge_expires_at?: string;
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
  category: string;
  invite_code: string;
  skip_penalty_type: string;
  created_by: string;
  created_at: string;
  members: ApiGroupMember[];
  ai_personality?: string | null;
}

export interface ApiChallenge {
  id: string;
  group_id: string;
  type: 'snap' | 'quiz' | 'quiz_food' | 'quiz_most_likely' | 'quiz_rate_day' | 'prompt';
  prompt: string | null;
  prompt_text: string | null;
  options: string[] | null;
  options_json: string[] | null;
  triggered_by: string | null;
  triggered_at: string;
  expires_at: string;
  status: 'active' | 'completed' | 'expired';
  countdown_seconds: number;
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
  answer_index: number | null;
  answer_text?: string | null;
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

export interface ApiSpotlight {
  id: string;
  group_id: string;
  featured_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  superlative: string;
  stats_json: {
    streak: number;
    total_responses: number;
    participation_rate: number;
    fun_fact: string;
  };
  date: string;
}

export interface ApiActivePenalty {
  id: string;
  user_id: string;
  display_name: string | null;
  penalty_type: string;
  description: string;
  expires_at: string;
}
