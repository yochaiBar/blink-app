/**
 * Photo relay hub — fan-out + ACK accounting + pending-pickup creation.
 *
 * The relay endpoint hands a (metadata, ciphertext) pair to this service.
 * The hub:
 *   1. Intersects the requested recipients with group membership and
 *      removes any who have blocked / been blocked by the sender.
 *   2. For each surviving recipient: if they have a connected socket, emit
 *      `photo:incoming` with `emitWithAck`; if they ACK within 30s, mark
 *      delivered. Otherwise (offline OR ack failure) write a
 *      `pending_photo_pickups` row in `pending` state.
 *   3. If this dispatch is fulfilling a pickup_request (caller passes
 *      `pickup_id`), ACK that row terminally so it doesn't loop.
 *
 * The hub does NOT persist photo bytes anywhere. Ciphertext is in memory
 * only for the duration of this call, then garbage-collected. The privacy
 * promise depends on this; do not introduce any persistence path here.
 *
 * Pickup-on-connect: `dispatchPendingPickupsForUser` is called from the
 * socket `connection` handler (registered via `onUserConnect`). It scans
 * pending rows where this user is the recipient and emits
 * `photo:pickup_request` to the matching sender's device-specific room.
 */

import { query } from '../config/database';
import {
  emitToUserDevice,
  emitToUserWithAck,
  isUserOnline,
  onUserConnect,
} from '../socket';
import logger from '../utils/logger';
import type {
  IncomingPhotoEnvelope,
  PhotoPickupRequest,
} from '../shared/photoProtocol';

const ACK_TIMEOUT_MS = 30_000;

export interface DispatchArgs {
  groupId: string;
  challengeId: string;
  responseId: string;
  senderUserId: string;
  senderDeviceId: string;
  ivB64: string;
  authTagB64: string;
  ciphertextB64: string;
  recipientUserIds: string[];
  pickupId?: string; // when fulfilling a pickup_request
}

export interface DispatchResult {
  deliveredUserIds: string[];
  queuedUserIds: string[];
}

interface BlockRow {
  blocker_id: string;
  blocked_id: string;
}

interface MemberRow {
  user_id: string;
}

/**
 * Returns the recipient_user_ids that should actually receive the photo:
 *   - must be a current member of the group
 *   - must not have blocked the sender, and must not be blocked by the sender
 *   - must not be the sender themselves
 *
 * Plan: defense in depth. The app filters too, but the server is the
 * authoritative gate — we never trust the sender's list verbatim.
 */
async function filterRecipients(
  groupId: string,
  senderUserId: string,
  requested: string[],
): Promise<string[]> {
  if (requested.length === 0) return [];

  // Strip the sender from their own list if it slips through.
  const candidates = requested.filter((id) => id !== senderUserId);
  if (candidates.length === 0) return [];

  // Membership check.
  const members = await query<MemberRow>(
    `SELECT user_id FROM group_members
      WHERE group_id = $1 AND user_id = ANY($2::uuid[])`,
    [groupId, candidates],
  );
  const memberIds = new Set(members.rows.map((r) => r.user_id));

  // Block-list check, symmetric. If sender blocked recipient OR recipient
  // blocked sender, drop.
  const blocks = await query<BlockRow>(
    `SELECT blocker_id, blocked_id FROM user_blocks
      WHERE (blocker_id = $1 AND blocked_id = ANY($2::uuid[]))
         OR (blocked_id = $1 AND blocker_id = ANY($2::uuid[]))`,
    [senderUserId, candidates],
  );
  const blockedIds = new Set<string>();
  for (const b of blocks.rows) {
    blockedIds.add(b.blocker_id === senderUserId ? b.blocked_id : b.blocker_id);
  }

  return candidates.filter(
    (id) => memberIds.has(id) && !blockedIds.has(id),
  );
}

/**
 * Insert a pending_photo_pickups row for an offline / failed recipient.
 * ON CONFLICT DO NOTHING because the UNIQUE (response_id, recipient, state)
 * keeps us from queuing the same recipient twice — if there's already a
 * `pending` row for them, the existing one is good enough.
 */
async function queuePending(
  args: Pick<
    DispatchArgs,
    'groupId' | 'challengeId' | 'responseId' | 'senderUserId' | 'senderDeviceId'
  >,
  recipientUserId: string,
): Promise<void> {
  await query(
    `INSERT INTO pending_photo_pickups
       (response_id, challenge_id, recipient_user_id, sender_user_id, sender_device_id, group_id, state)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     ON CONFLICT (response_id, recipient_user_id, state) DO NOTHING`,
    [
      args.responseId,
      args.challengeId,
      recipientUserId,
      args.senderUserId,
      args.senderDeviceId,
      args.groupId,
    ],
  );
}

/**
 * Mark a pending row terminally `acked`. Used both:
 *   - by the relay route when a pickup_request fulfillment is acknowledged
 *   - by an explicit ack from the recipient (Phase 4: `photo:ack` socket event)
 */
async function ackPendingPickup(pickupId: string): Promise<void> {
  await query(
    `UPDATE pending_photo_pickups
        SET state = 'acked', state_changed_at = NOW()
      WHERE id = $1 AND state IN ('pending', 'in_flight')`,
    [pickupId],
  );
}

/**
 * Main entry point. Fan out one encrypted photo to its recipients.
 */
export async function dispatchPhoto(args: DispatchArgs): Promise<DispatchResult> {
  const finalRecipients = await filterRecipients(
    args.groupId,
    args.senderUserId,
    args.recipientUserIds,
  );

  if (finalRecipients.length === 0) {
    // The request was either malformed (no valid recipients) or every
    // requested recipient was filtered out. Either way: nothing to do,
    // not an error.
    if (args.pickupId) {
      await ackPendingPickup(args.pickupId);
    }
    return { deliveredUserIds: [], queuedUserIds: [] };
  }

  const envelope: IncomingPhotoEnvelope = {
    v: 1,
    group_id: args.groupId,
    challenge_id: args.challengeId,
    response_id: args.responseId,
    sender_user_id: args.senderUserId,
    sender_device_id: args.senderDeviceId,
    iv_b64: args.ivB64,
    auth_tag_b64: args.authTagB64,
  };

  const delivered: string[] = [];
  const queued: string[] = [];

  await Promise.all(
    finalRecipients.map(async (recipientId) => {
      if (!(await isUserOnline(recipientId))) {
        await queuePending(args, recipientId);
        queued.push(recipientId);
        return;
      }
      const result = await emitToUserWithAck(
        recipientId,
        'photo:incoming',
        // The envelope + ciphertext_b64 travel together. Recipient slices off
        // the ciphertext from the JSON payload, base64-decodes, decrypts.
        { ...envelope, ciphertext_b64: args.ciphertextB64 },
        ACK_TIMEOUT_MS,
      );
      // ANY socket of this user ACKing successfully = delivered. If every
      // socket NACKed or timed out, fall back to pending.
      if (result.acked > 0) {
        delivered.push(recipientId);
      } else {
        await queuePending(args, recipientId);
        queued.push(recipientId);
      }
    }),
  );

  if (args.pickupId) {
    await ackPendingPickup(args.pickupId);
  }

  // Privacy-safe summary log: counts only, no IDs.
  logger.info('photo relay dispatched', {
    delivered_count: delivered.length,
    queued_count: queued.length,
    recipient_count: finalRecipients.length,
  });

  return { deliveredUserIds: delivered, queuedUserIds: queued };
}

interface PendingRow {
  id: string;
  response_id: string;
  challenge_id: string;
  group_id: string;
  sender_user_id: string;
  sender_device_id: string;
}

/**
 * On recipient connect: find pending pickups for this user, mark them
 * `in_flight`, and emit `photo:pickup_request` to the sender's specific
 * device. The sender's device responds by POSTing to /api/photos/relay
 * with the same ciphertext (re-encrypted from its local plaintext cache).
 *
 * If the sender's device isn't online either, the row stays `in_flight`;
 * the next time the recipient or sender connects we re-attempt. The TTL
 * cleanup job eventually moves stale rows to `expired`.
 */
export async function dispatchPendingPickupsForUser(
  recipientUserId: string,
): Promise<number> {
  // Atomic claim: flip pending → in_flight and capture the rows we're now
  // responsible for emitting. Other listeners (if any) won't see these as
  // pending anymore. Re-check the recipient still exists is implicit
  // via FK to users.
  const claimed = await query<PendingRow>(
    `UPDATE pending_photo_pickups
        SET state = 'in_flight', state_changed_at = NOW()
      WHERE recipient_user_id = $1 AND state = 'pending'
     RETURNING id, response_id, challenge_id, group_id, sender_user_id, sender_device_id`,
    [recipientUserId],
  );

  if (claimed.rows.length === 0) return 0;

  for (const row of claimed.rows) {
    const payload: PhotoPickupRequest = {
      v: 1,
      response_id: row.response_id,
      challenge_id: row.challenge_id,
      group_id: row.group_id,
      recipient_user_id: recipientUserId,
      pickup_id: row.id,
    };
    emitToUserDevice(
      row.sender_user_id,
      row.sender_device_id,
      'photo:pickup_request',
      payload,
    );
  }

  logger.info('pickup_requests dispatched', {
    recipient_count: 1,
    request_count: claimed.rows.length,
  });

  return claimed.rows.length;
}

let registered = false;

/**
 * Wire the pickup-on-connect listener. Idempotent — calling twice in test
 * setup or hot-reload is safe. Called once from server startup in index.ts.
 */
export function registerRelayHub(): void {
  if (registered) return;
  registered = true;
  onUserConnect(async (userId) => {
    await dispatchPendingPickupsForUser(userId);
  });
}

// ── TTL cleanup ────────────────────────────────────────────────────

const TTL_DAYS = 7;

/**
 * Move stale `pending` / `in_flight` rows to `expired` after the TTL.
 * Returns the number of rows touched. Designed to be called from a cron
 * job; idempotent across runs.
 */
export async function expireStalePendingPickups(): Promise<number> {
  const result = await query(
    `UPDATE pending_photo_pickups
        SET state = 'expired', state_changed_at = NOW()
      WHERE state IN ('pending', 'in_flight')
        AND created_at < NOW() - INTERVAL '${TTL_DAYS} days'`,
  );
  return result.rowCount ?? 0;
}
