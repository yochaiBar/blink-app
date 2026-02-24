import { z } from 'zod';

// ── Auth schemas ──────────────────────────────────────────────

/**
 * E.164 phone number format: + followed by 1-15 digits
 */
const phoneNumberSchema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, 'Invalid phone number format. Use E.164 format (e.g. +15551234567)');

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
}).refine(
  (data) => data.display_name !== undefined || data.avatar_url !== undefined,
  { message: 'At least one field (display_name or avatar_url) must be provided' }
);

// ── Group schemas ─────────────────────────────────────────────

const groupCategoryEnum = z.enum(['friends', 'family', 'students', 'work', 'custom']);
const penaltyTypeEnum = z.enum(['wanted_poster', 'avatar_change', 'servant', 'none']);

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
});

export const joinGroupSchema = z.object({
  invite_code: z.string().min(1, 'invite_code is required'),
});

// ── Challenge schemas ─────────────────────────────────────────

const challengeTypeEnum = z.enum(['snap', 'quiz_food', 'quiz_most_likely', 'quiz_rate_day']);

export const createChallengeSchema = z.object({
  type: challengeTypeEnum.optional(),
});

export const respondChallengeSchema = z.object({
  photo_url: z.string().optional(),
  response_time_ms: z.number().int().positive().optional(),
  answer_index: z.number().int().min(0).optional(),
});

// ── Reaction schemas ─────────────────────────────────────────

export const addReactionSchema = z.object({
  emoji: z
    .string()
    .min(1, 'Emoji is required')
    .max(10, 'Emoji must be at most 10 characters'),
});
