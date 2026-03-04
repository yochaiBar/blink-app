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
}

export interface ApiChallenge {
  id: string;
  group_id: string;
  type: 'snap' | 'quiz' | 'quiz_food' | 'quiz_most_likely' | 'quiz_rate_day' | 'prompt';
  prompt: string | null;
  prompt_text: string | null;
  options: string[] | null;
  options_json: string[] | null;
  triggered_by: string;
  triggered_at: string;
  expires_at: string;
  status: 'active' | 'completed' | 'expired';
  countdown_seconds: number;
  user_has_responded?: boolean;
}

export interface ApiChallengeResponse {
  id: string;
  challenge_id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  photo_url: string | null;
  answer_index: number | null;
  answer_text?: string | null;
  response_time_ms: number | null;
  responded_at: string;
  created_at: string;
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
