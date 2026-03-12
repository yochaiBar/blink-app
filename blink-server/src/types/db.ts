/**
 * Database row type interfaces.
 *
 * Each interface mirrors the columns of its corresponding PostgreSQL table
 * as defined in src/config/migrate.ts.  Use them to parameterise the generic
 * `query<T>(...)` helper so that `result.rows` is properly typed.
 */

// ── Core tables ──────────────────────────────────────────────────

export interface UserRow {
  id: string;
  phone_number: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  push_token: string | null;
  created_at: Date;
  last_active_at: Date;
}

export interface GroupRow {
  id: string;
  name: string;
  icon: string;
  category: string;
  created_by: string;
  invite_code: string;
  max_members: number;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  skip_penalty_type: string;
  ai_personality: string;
  group_streak: number;
  longest_group_streak: number;
  created_at: Date;
}

export interface GroupMemberRow {
  id: string;
  group_id: string;
  user_id: string;
  role: string;
  joined_at: Date;
  current_streak: number;
  total_responses: number;
  total_challenges: number;
}

export interface ChallengeRow {
  id: string;
  group_id: string;
  type: string;
  prompt_text: string | null;
  options_json: string | null;
  triggered_by: string;
  triggered_at: Date;
  expires_at: Date;
  countdown_seconds: number;
  status: string;
  is_auto_generated: boolean;
  ai_generated_prompt: string | null;
  ai_commentary: string | null;
}

export interface ChallengeResponseRow {
  id: string;
  challenge_id: string;
  user_id: string;
  response_type: string;
  photo_url: string | null;
  answer_index: number | null;
  answer_text: string | null;
  responded_at: Date;
  response_time_ms: number | null;
}

// ── Supporting tables ────────────────────────────────────────────

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  group_id: string | null;
  from_user_id: string | null;
  read: boolean;
  created_at: Date;
}

export interface ReactionRow {
  id: string;
  response_id: string;
  user_id: string;
  emoji: string;
  created_at: Date;
}

export interface SpotlightRow {
  id: string;
  group_id: string;
  featured_user_id: string;
  superlative: string | null;
  stats_json: unknown;
  date: Date;
  created_at: Date;
}

export interface ActivePenaltyRow {
  id: string;
  group_id: string;
  user_id: string;
  penalty_type: string;
  penalty_data: unknown;
  expires_at: Date;
  created_at: Date;
}

export interface BlockRow {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: Date;
}

export interface ReportRow {
  id: string;
  reporter_id: string;
  reported_user_id: string | null;
  reported_content_id: string | null;
  content_type: string;
  reason: string;
  description: string | null;
  status: string;
  created_at: Date;
}

export interface OtpRequestRow {
  id: string;
  phone_number: string;
  code_hash: string;
  expires_at: Date;
  attempts: number;
  created_at: Date;
}

export interface RevokedTokenRow {
  id: string;
  user_id: string;
  revoked_at: Date;
}

export interface ContentModerationLogRow {
  id: string;
  user_id: string | null;
  content_type: string;
  s3_key: string | null;
  safe: boolean | null;
  labels: unknown;
  confidence: number | null;
  created_at: Date;
}

export interface StreakShieldRow {
  id: string;
  user_id: string;
  group_id: string;
  earned_at: Date;
  used_at: Date | null;
  used_for_challenge_id: string | null;
}

export interface StreakMilestoneRow {
  id: string;
  user_id: string;
  group_id: string;
  milestone: number;
  reached_at: Date;
}

export interface ChallengeScheduleRow {
  id: string;
  group_id: string;
  last_auto_challenge_at: Date | null;
  updated_at: Date;
}

export interface AiGenerationLogRow {
  id: string;
  group_id: string;
  function_name: string;
  personality: string | null;
  tokens_used: number | null;
  latency_ms: number | null;
  fallback_used: boolean;
  created_at: Date;
}

// ── Convenience types for common JOIN / aggregate shapes ─────────

/** Returned by COUNT(*) queries */
export interface CountRow {
  count: string;
}

/** User display name only (common lookup) */
export interface UserDisplayNameRow {
  display_name: string | null;
}
