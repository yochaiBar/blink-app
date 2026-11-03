/**
 * Photo relay hub (protocol v2): authorize, fan out, and queue pickups.
 *
 * The relay route hands this service one encrypted photo. The hub:
 *   1. Authorizes: the caller must own the response, still be a member of
 *      its group, and have encrypted under the group's current key version.
 *   2. Picks recipients itself: the sender's audience (other members, minus
 *      anyone blocked with the sender), or the one recipient of the pickup
 *      being fulfilled. The client never chooses who receives a photo.
 *   3. For each recipient: if online, emit `photo:incoming` and wait for the
 *      ACK; on success the recipient's pickup (if any) is deleted. Otherwise
 *      a pickup row is queued.
 *
 * Pickups: one row per (response, recipient), deleted on delivery. When the
 * recipient and the sender's originating device are both online, the row
 * is claimed with a short lease and `photo:pickup_request` asks that device
 * to re-encrypt and re-relay. An unanswered lease just expires; the next
 * connect of either party offers it again. Rows older than 7 days are reaped.
 *
 * The hub never persists photo bytes: ciphertext lives in memory only for
 * the duration of a call. The privacy promise depends on this.
 */

import { query } from '../config/database';
import {
  emitToUserDevice,
  emitToUserWithAck,
  isDeviceOnline,
  isUserOnline,
  onDeviceReady,
  onUserConnect,
} from '../socket';
import { HttpError } from '../utils/httpError';
import logger from '../utils/logger';
import type { IncomingPhotoEnvelope, PhotoPickupRequest } from '../shared/photoProtocol';

const ACK_TIMEOUT_MS = 30_000;
/** How long a claimed pickup waits for the sender's re-relay before it's offered again. */
export const PICKUP_LEASE_SECONDS = 120;
const PICKUP_TTL_DAYS = 7;

export interface DispatchArgs {
  callerUserId: string;
  responseId: string;
  senderDeviceId: string;
  keyVersion: number;
  ivB64: string;
  ciphertextB64: string;
  pickupId?: string;
}

export interface DispatchResult {
  deliveredUserIds: string[];
  queuedUserIds: string[];
}

interface ResponseContext {
  owner_id: string;
  challenge_id: string;
  group_id: string;
  group_key_version: number;
  is_member: boolean;
}

async function loadContext(responseId: string, callerUserId: string): Promise<ResponseContext> {
  const result = await query<ResponseContext>(
    `SELECT cr.user_id AS owner_id, c.id AS challenge_id, c.group_id, g.group_key_version,
            EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = c.group_id AND gm.user_id = $2) AS is_member
       FROM challenge_responses cr
       JOIN challenges c ON c.id = cr.challenge_id
       JOIN groups g ON g.id = c.group_id
      WHERE cr.id = $1`,
    [responseId, callerUserId],
  );
  const ctx = result.rows[0];
  if (!ctx) throw new HttpError(404, 'Response not found');
  if (ctx.owner_id !== callerUserId) throw new HttpError(403, 'Only the response’s author can relay its photo');
  if (!ctx.is_member) throw new HttpError(403, 'Not a member of this group');
  return ctx;
}

async function queuePickup(ctx: ResponseContext, args: DispatchArgs, recipientUserId: string): Promise<void> {
  await query(
    `INSERT INTO pending_photo_pickups
       (response_id, challenge_id, group_id, recipient_user_id, sender_user_id, sender_device_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (response_id, recipient_user_id)
       DO UPDATE SET sender_device_id = EXCLUDED.sender_device_id, lease_expires_at = NULL`,
    [args.responseId, ctx.challenge_id, ctx.group_id, recipientUserId, args.callerUserId, args.senderDeviceId],
  );
}

async function dropPickup(responseId: string, recipientUserId: string): Promise<void> {
  await query(`DELETE FROM pending_photo_pickups WHERE response_id = $1 AND recipient_user_id = $2`, [
    responseId,
    recipientUserId,
  ]);
}

/** Main entry point: authorize and fan out one encrypted photo. */
export async function dispatchPhoto(args: DispatchArgs): Promise<DispatchResult> {
  const ctx = await loadContext(args.responseId, args.callerUserId);
  if (args.keyVersion !== ctx.group_key_version) {
    throw new HttpError(409, 'Group key version mismatch');
  }

  let recipients: string[];
  if (args.pickupId) {
    // Fulfilling a pickup: only its sender may, and only for its recipient.
    const claimed = await query<{ recipient_user_id: string }>(
      `DELETE FROM pending_photo_pickups
        WHERE id = $1 AND sender_user_id = $2 AND response_id = $3
        RETURNING recipient_user_id`,
      [args.pickupId, args.callerUserId, args.responseId],
    );
    if (claimed.rows.length === 0) throw new HttpError(404, 'Pickup not found');
    const stillAudience = await query(`SELECT 1 FROM audience($1, $2) WHERE user_id = $3`, [
      ctx.group_id,
      args.callerUserId,
      claimed.rows[0].recipient_user_id,
    ]);
    recipients = stillAudience.rows.length > 0 ? [claimed.rows[0].recipient_user_id] : [];
  } else {
    const audience = await query<{ user_id: string }>(`SELECT user_id FROM audience($1, $2)`, [
      ctx.group_id,
      args.callerUserId,
    ]);
    recipients = audience.rows.map((r) => r.user_id);
  }

  const envelope: IncomingPhotoEnvelope = {
    v: 2,
    group_id: ctx.group_id,
    challenge_id: ctx.challenge_id,
    response_id: args.responseId,
    sender_user_id: args.callerUserId,
    sender_device_id: args.senderDeviceId,
    key_version: args.keyVersion,
    iv_b64: args.ivB64,
    ciphertext_b64: args.ciphertextB64,
  };

  const delivered: string[] = [];
  const queued: string[] = [];
  await Promise.all(
    recipients.map(async (recipientId) => {
      const result = (await isUserOnline(recipientId))
        ? await emitToUserWithAck(recipientId, 'photo:incoming', envelope, ACK_TIMEOUT_MS)
        : { acked: 0 };
      // ANY socket of this user ACKing = delivered. Offline, NACK or timeout = queue.
      if (result.acked > 0) {
        await dropPickup(args.responseId, recipientId);
        delivered.push(recipientId);
      } else {
        await queuePickup(ctx, args, recipientId);
        queued.push(recipientId);
      }
    }),
  );

  // Privacy-safe summary log: counts only, no IDs.
  logger.info('photo relay dispatched', {
    delivered_count: delivered.length,
    queued_count: queued.length,
    pickup: !!args.pickupId,
  });

  return { deliveredUserIds: delivered, queuedUserIds: queued };
}

interface PickupRow {
  id: string;
  response_id: string;
  challenge_id: string;
  group_id: string;
  recipient_user_id: string;
  sender_user_id: string;
  sender_device_id: string;
}

/**
 * Offer every claimable pickup that involves `userId` (as recipient or as
 * sender) and whose other party is online now: claim it with a lease, then
 * ask the sender's device to re-relay. Returns how many requests went out.
 */
export async function dispatchPickupsFor(userId: string): Promise<number> {
  const candidates = await query<PickupRow>(
    `SELECT id, response_id, challenge_id, group_id, recipient_user_id, sender_user_id, sender_device_id
       FROM pending_photo_pickups
      WHERE (recipient_user_id = $1 OR sender_user_id = $1)
        AND (lease_expires_at IS NULL OR lease_expires_at < NOW())`,
    [userId],
  );

  let sent = 0;
  for (const row of candidates.rows) {
    const bothOnline =
      (await isUserOnline(row.recipient_user_id)) && (await isDeviceOnline(row.sender_user_id, row.sender_device_id));
    if (!bothOnline) continue;

    // Atomic claim: only one dispatcher wins a free (or lapsed) lease.
    const claim = await query(
      `UPDATE pending_photo_pickups
          SET lease_expires_at = NOW() + make_interval(secs => $2)
        WHERE id = $1 AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
        RETURNING id`,
      [row.id, PICKUP_LEASE_SECONDS],
    );
    if (claim.rows.length === 0) continue;

    const request: PhotoPickupRequest = {
      v: 2,
      response_id: row.response_id,
      challenge_id: row.challenge_id,
      group_id: row.group_id,
      recipient_user_id: row.recipient_user_id,
      pickup_id: row.id,
    };
    emitToUserDevice(row.sender_user_id, row.sender_device_id, 'photo:pickup_request', request);
    sent++;
  }

  if (sent > 0) logger.info('pickup_requests dispatched', { request_count: sent });
  return sent;
}

let registered = false;

/**
 * Wire dispatch-on-connect: a recipient or sender connecting, or a sender's
 * device identifying itself, may make pickups deliverable. Idempotent.
 */
export function registerRelayHub(): void {
  if (registered) return;
  registered = true;
  onUserConnect(async (userId) => {
    await dispatchPickupsFor(userId);
  });
  onDeviceReady(async (userId) => {
    await dispatchPickupsFor(userId);
  });
}

/** Delete pickups older than the TTL (privacy: no lingering social-graph metadata). */
export async function reapOldPickups(): Promise<number> {
  const result = await query(`DELETE FROM pending_photo_pickups WHERE created_at < NOW() - make_interval(days => $1)`, [
    PICKUP_TTL_DAYS,
  ]);
  return result.rowCount ?? 0;
}
