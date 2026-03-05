import { z } from 'zod';

// ── Auth schemas ──────────────────────────────────────────────

const phoneNumberSchema = z
  .string()
  .transform((val) => val.startsWith('+') ? val : `+${val}`)
  .pipe(z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid phone number format. Use E.164 format (e.g. +15551234567)'));

export const requestOtpSchema = z.object({
  phone_number: phoneNumberSchema,
});

export const verifyOtpSchema = z.object({
  phone_number: phoneNumberSchema,
  code: z
    .string()
    .regex(/^\d{6}$/, 'OTP code must be exactly 6 digits'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

// ── Profile schemas ───────────────────────────────────────────

export const updateProfileSchema = z.object({
  display_name: z
    .string()
    .min(1, 'Display name must be at least 1 character')
    .max(50, 'Display name must be at most 50 characters')
    .optional(),
  avatar_url: z
    .string()
    .url('Must be a valid URL')
    .or(z.literal(''))
    .optional(),
  bio: z
    .string()
    .max(200, 'Bio must be at most 200 characters')
    .optional(),
}).refine(
  (data) => data.display_name !== undefined || data.avatar_url !== undefined || data.bio !== undefined,
  { message: 'At least one field (display_name, avatar_url, or bio) must be provided' }
);

// ── Group schemas ─────────────────────────────────────────────

const groupCategoryEnum = z.enum(['friends', 'family', 'students', 'work', 'custom']);
const penaltyTypeEnum = z.enum(['wanted_poster', 'avatar_change', 'servant', 'none']);
const aiPersonalityEnum = z.enum(['family_friendly', 'funny', 'spicy', 'sarcastic', 'motivational', 'extreme', 'sexy', 'no_filter']);

export const createGroupSchema = z.object({
  name: z
    .string()
    .min(1, 'Group name must be at least 1 character')
    .max(100, 'Group name must be at most 100 characters'),
  icon: z.string().max(10).optional(),
  category: groupCategoryEnum.optional(),
  quiet_hours_start: z.string().optional(),
  quiet_hours_end: z.string().optional(),
  skip_penalty_type: penaltyTypeEnum.optional(),
  ai_personality: aiPersonalityEnum.optional(),
});

export const joinGroupSchema = z.object({
  invite_code: z.string().min(1, 'invite_code is required'),
});

// ── Challenge schemas ─────────────────────────────────────────

const challengeTypeEnum = z.enum(['snap', 'quiz_food', 'quiz_most_likely', 'quiz_rate_day', 'prompt']);

export const createChallengeSchema = z.object({
  type: challengeTypeEnum.optional(),
  prompt_text: z.string().min(1).max(500).optional(),
  options: z.array(z.string().max(200)).max(10).optional(),
  correct_answer: z.number().int().min(0).optional(),
}).refine(
  (data) => {
    if (data.type === 'prompt' && !data.prompt_text) return false;
    return true;
  },
  { message: 'prompt_text is required when type is prompt' }
);

export const respondChallengeSchema = z.object({
  photo_url: z.string().optional(),
  photo_base64: z.string().optional(),
  response_time_ms: z.number().int().positive().optional(),
  answer_index: z.number().int().min(0).optional(),
  answer_text: z.string().max(500).optional(),
});

// ── Reaction schemas ─────────────────────────────────────────

export const addReactionSchema = z.object({
  emoji: z
    .string()
    .min(1, 'Emoji is required')
    .max(10, 'Emoji must be at most 10 characters'),
});

// ── Moderation schemas ──────────────────────────────────────

const contentTypeEnum = z.enum(['photo', 'user', 'group', 'challenge_response']);
const reportReasonEnum = z.enum(['inappropriate', 'spam', 'harassment', 'hate_speech', 'nudity', 'violence', 'other']);

export const createReportSchema = z.object({
  reported_user_id: z.string().uuid().optional(),
  reported_content_id: z.string().uuid().optional(),
  content_type: contentTypeEnum,
  reason: reportReasonEnum,
  description: z.string().max(500).optional(),
});

export const blockUserSchema = z.object({
  blocked_id: z.string().uuid('Invalid user ID'),
});

// ── Push token schemas ──────────────────────────────────────

export const pushTokenSchema = z.object({
  push_token: z
    .string()
    .min(1, 'push_token is required')
    .refine(
      (val) => val.startsWith('ExponentPushToken['),
      'push_token must be a valid Expo push token (starts with "ExponentPushToken[")'
    ),
});

// ── Upload schemas ──────────────────────────────────────────

export const presignUploadSchema = z.object({
  groupId: z.string().uuid('Invalid group ID'),
  challengeId: z.string().uuid('Invalid challenge ID'),
});
