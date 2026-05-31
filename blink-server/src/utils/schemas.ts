import { z } from 'zod';

const S3_BUCKET = process.env.AWS_S3_BUCKET || 'blinks3upload';
const isS3Url = (url: string) =>
  url.startsWith(`https://${S3_BUCKET}.s3.`) ||
  url.startsWith(`https://s3.amazonaws.com/${S3_BUCKET}/`) ||
  url.startsWith(`https://${S3_BUCKET}.s3.amazonaws.com/`);

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
  display_name: z.string().trim().min(1, 'Display name is required').max(50, 'Display name too long').optional(),
  avatar_url: z.string().url().refine(isS3Url, { message: 'avatar_url must be from the allowed S3 bucket' }).or(z.literal('')).optional(),
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
  photo_url: z.string().url().refine(
    (url) => isS3Url(url) || url.startsWith('data:image/'),
    { message: 'photo_url must be from the allowed S3 bucket or a data URI' }
  ).optional(),
  photo_base64: z.string().max(5_000_000, 'Image data too large (max ~3.75MB)').optional(),
  response_time_ms: z.number().int().positive().optional(),
  answer_index: z.number().int().min(0).optional(),
  answer_text: z.string().max(500).optional(),
  encryption_metadata: z.object({
    v: z.number(),
    alg: z.string(),
    iv: z.string(),
    tag: z.string(),
    key_enc: z.string(),
  }).optional(),
});

// ── Reaction schemas ─────────────────────────────────────────

export const addReactionSchema = z.object({
  emoji: z
    .string()
    .min(1, 'Emoji is required')
    .max(10, 'Emoji must be at most 10 characters'),
});

// ── Comment schemas ─────────────────────────────────────────

export const createCommentSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(280, 'Comment must be at most 280 characters'),
  parent_comment_id: z.string().uuid().optional(),
});

// ── Device public key schemas (E2E photo flow, Phase 2) ─────

// base64(32 bytes) = 44 chars. Strict — anything else is a protocol error.
const base64_32bytes = z
  .string()
  .length(44, 'Must be base64-encoded 32 bytes (44 chars)')
  .regex(/^[A-Za-z0-9+/]{43}=$/, 'Must be valid base64');

export const registerDeviceKeySchema = z.object({
  v: z.literal(1),
  device_id: z.string().uuid(),
  x25519_public_key_b64: base64_32bytes,
  attestation_b64: base64_32bytes,
});

// ── Photo relay schemas (E2E photo flow, Phase 3) ────────────

// IV is 12 bytes for GCM → base64 = 16 chars with NO padding
// (12 is divisible by 3, so the encoding ends cleanly).
const base64_12bytes = z
  .string()
  .length(16, 'Must be base64-encoded 12 bytes (16 chars)')
  .regex(/^[A-Za-z0-9+/]{16}$/, 'Must be valid base64');

// GCM auth tag is 16 bytes → base64 = 24 chars.
const base64_16bytes = z
  .string()
  .length(24, 'Must be base64-encoded 16 bytes (24 chars)')
  .regex(/^[A-Za-z0-9+/]{22}==$/, 'Must be valid base64');

// Generic base64 string for the ciphertext blob — bounded so we reject a
// 50 MB body before the JSON parser melts. 12 MB base64 ≈ 9 MB binary, well
// over a typical phone photo and matches the Socket.io maxHttpBufferSize.
const base64_ciphertext = z
  .string()
  .min(1, 'ciphertext required')
  .max(12 * 1024 * 1024, 'ciphertext exceeds size limit')
  .regex(/^[A-Za-z0-9+/=]+$/, 'Must be valid base64');

export const relayPhotoSchema = z.object({
  v: z.literal(1),
  group_id: z.string().uuid(),
  challenge_id: z.string().uuid(),
  response_id: z.string().uuid(),
  sender_device_id: z.string().uuid(),
  iv_b64: base64_12bytes,
  auth_tag_b64: base64_16bytes,
  recipient_user_ids: z.array(z.string().uuid()).min(1).max(64),
  ciphertext_b64: base64_ciphertext,
  pickup_id: z.string().uuid().optional(),
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

export const encryptedUploadSchema = z.object({
  image_base64: z.string().max(7_000_000, 'Image data too large (max ~5MB after base64 encoding)'),
  groupId: z.string().uuid('Invalid group ID'),
  challengeId: z.string().uuid('Invalid challenge ID'),
});
