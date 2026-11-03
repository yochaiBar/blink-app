import { z } from 'zod';
import { isValidTimeZone } from '../jobs/dailyChallenge';

// ── Shared query schemas ──────────────────────────────────────

// Cursor pagination: newest first, `before` = created_at of the last item seen.
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().datetime({ offset: true }).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

// ── Auth schemas ──────────────────────────────────────────────

const phoneNumberSchema = z
  .string()
  .transform((val) => (val.startsWith('+') ? val : `+${val}`))
  .pipe(z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid phone number format. Use E.164 format (e.g. +15551234567)'));

export const requestOtpSchema = z.object({
  phone_number: phoneNumberSchema,
});

export const verifyOtpSchema = z.object({
  phone_number: phoneNumberSchema,
  code: z.string().regex(/^\d{6}$/, 'OTP code must be exactly 6 digits'),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1, 'refresh_token is required').max(200),
});

// ── Profile schemas ───────────────────────────────────────────

export const updateProfileSchema = z
  .object({
    display_name: z.string().trim().min(1, 'Display name is required').max(50, 'Display name too long').optional(),
    bio: z.string().max(200, 'Bio must be at most 200 characters').optional(),
    push_enabled: z.boolean().optional(),
  })
  .refine((data) => data.display_name !== undefined || data.bio !== undefined || data.push_enabled !== undefined, {
    message: 'At least one field (display_name, bio or push_enabled) must be provided',
  });

// ── Group schemas ─────────────────────────────────────────────

export const createGroupSchema = z.object({
  name: z
    .string()
    .min(1, 'Group name must be at least 1 character')
    .max(100, 'Group name must be at most 100 characters'),
  icon: z.string().max(10).optional(),
  quiet_hours_start: z.string().optional(),
  quiet_hours_end: z.string().optional(),
  // IANA zone (e.g. 'Asia/Jerusalem') for the daily challenge's day hours.
  timezone: z.string().max(64).refine(isValidTimeZone, { message: 'timezone must be an IANA time zone' }).optional(),
});

export const joinGroupSchema = z.object({
  invite_code: z.string().min(1, 'invite_code is required'),
  // Optional during the v1/v2 migration: v1 clients won't send a device_id
  // and skip the keyshare enqueue. v2 clients always include it so the
  // server can route the courier handshake to the right device.
  device_id: z.string().uuid().optional(),
});

// ── Challenge schemas ─────────────────────────────────────────

// Snap is the only challenge type; the body carries nothing yet.
export const createChallengeSchema = z.object({});

export const respondChallengeSchema = z.object({
  // The client tells us "I will relay the actual bytes via /api/photos/relay
  // separately." The server records has_photo=true and never sees the photo.
  has_photo: z.boolean().optional(),
});

// ── Reaction schemas ─────────────────────────────────────────

export const addReactionSchema = z.object({
  emoji: z.string().min(1, 'Emoji is required').max(10, 'Emoji must be at most 10 characters'),
});

// ── Comment schemas ─────────────────────────────────────────

export const createCommentSchema = z.object({
  text: z.string().trim().min(1, 'Comment cannot be empty').max(280, 'Comment must be at most 280 characters'),
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

// Generic base64 string for the ciphertext blob — bounded so we reject a
// 50 MB body before the JSON parser melts. 12 MB base64 ≈ 9 MB binary, well
// over a typical phone photo and matches the Socket.io maxHttpBufferSize.
const base64_ciphertext = z
  .string()
  .min(1, 'ciphertext required')
  .max(12 * 1024 * 1024, 'ciphertext exceeds size limit')
  .regex(/^[A-Za-z0-9+/=]+$/, 'Must be valid base64');

export const relayPhotoSchema = z.object({
  v: z.literal(2),
  response_id: z.string().uuid(),
  sender_device_id: z.string().uuid(),
  key_version: z.number().int().min(1),
  iv_b64: base64_12bytes,
  ciphertext_b64: base64_ciphertext,
  pickup_id: z.string().uuid().optional(),
});

// ── Keyshare schemas (E2E photo flow, Phase 4) ───────────────

// 32-byte group key + 16-byte GCM tag = 48 bytes → base64 = 64 chars with no
// padding (48 is divisible by 3). The envelope is opaque to the server but
// we sanity-check its length so a malformed payload fails at Zod, not at
// the joiner.
const base64_48bytes = z
  .string()
  .length(64, 'Must be base64-encoded 48 bytes (64 chars)')
  .regex(/^[A-Za-z0-9+/]{64}$/, 'Must be valid base64');

// GET /api/device-keys?group_id= — fellow members' device keys.
export const groupDeviceKeysQuerySchema = z.object({
  group_id: z.string().uuid(),
});

const keyVersion = z.number().int().min(1);

export const keyshareDeliverSchema = z.object({
  v: z.literal(2),
  pending_join_id: z.string().uuid(),
  from_device_id: z.string().uuid(),
  key_version: keyVersion,
  ephemeral_public_key_b64: base64_32bytes,
  iv_b64: base64_12bytes,
  ciphertext_b64: base64_48bytes,
});

// Recovery: a member without the current key asks for it on this device.
export const keyshareRequestSchema = z.object({
  v: z.literal(2),
  group_id: z.string().uuid(),
  device_id: z.string().uuid(),
});

// A member's device now holds the group key at key_version.
export const keyshareConfirmSchema = z.object({
  v: z.literal(2),
  group_id: z.string().uuid(),
  key_version: keyVersion,
});

// Reset, step one: an admin bumps the group key version (server tracks
// version only, never the key). Step two is the admin's confirm.
export const keyshareResetSchema = z.object({
  v: z.literal(2),
  group_id: z.string().uuid(),
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
      'push_token must be a valid Expo push token (starts with "ExponentPushToken[")',
    ),
});

// (Legacy upload schemas removed in Phase 6 alongside the routes that
// consumed them. The v2 photo flow uses relayPhotoSchema above.)
