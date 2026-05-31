/**
 * Group-key courier handshake hub — orchestrates the Phase 4 flow.
 *
 * Flow (high level)
 * ─────────────────
 *   1. Joiner Bob joins group G via POST /api/groups/join.
 *   2. `enqueueKeyshare(G, Bob, BobDevice)` writes a `pending_joins` row.
 *      If any existing member is online, an immediate dispatch tries to
 *      hand the row to a courier; otherwise it waits.
 *   3. When ANY existing member of G connects, the socket connect
 *      listener fires `dispatchPendingKeysharesForUser(courierId)`. That
 *      function atomically claims pending rows whose group the courier
 *      belongs to (`pending → in_flight`), looks up the joiner's current
 *      device public key from `device_public_keys`, and emits
 *      `group:keyshare_request` to the courier's device-specific room.
 *   4. The courier's device performs X25519 ECDH + HKDF + AES-GCM
 *      against the joiner's static public key (already battle-tested in
 *      Phase 2's `courierEncryptGroupKey`) and POSTs the envelope to
 *      `/api/keyshare/deliver`.
 *   5. The deliver route calls `markKeyshareDelivered`, which flips the
 *      row to `delivered` and emits `group:keyshare_envelope` to the
 *      joiner's device room. The joiner decrypts and stores locally.
 *
 * The server never touches the group key in any state. The envelope is
 * opaque ciphertext on the wire.
 *
 * Race resolution
 * ───────────────
 * Two existing members of G could connect at the same instant when a
 * single pending row exists. Only ONE wins: the `UPDATE ... WHERE state =
 * 'pending' RETURNING *` is atomic at the row level — Postgres serializes
 * it. The losing connect listener simply finds zero rows and does nothing.
 * No `keyshare_cancelled` event needed.
 *
 * Multi-courier broadcast (an alternative we rejected): emit to all online
 * members and let only one win. That would require explicit cancel events,
 * client-side dedup, and a way to refund a stolen claim. The simpler
 * "first-to-claim-wins" model is good enough for the small-group case.
 */

import { query } from '../config/database';
import { emitToUser, onUserConnect } from '../socket';
import logger from '../utils/logger';
import type { KeyshareRequest } from '../shared/photoProtocol';

const TTL_DAYS = 7;

interface PendingJoinRow {
  id: string;
  group_id: string;
  joiner_user_id: string;
  joiner_device_id: string;
}

interface JoinerKeyRow {
  device_id: string;
  x25519_public_key: string;
}

// ─────────────────────────────────────────────────────────────────
// enqueueKeyshare — called at join time
// ─────────────────────────────────────────────────────────────────

export interface EnqueueKeyshareArgs {
  groupId: string;
  joinerUserId: string;
  joinerDeviceId: string;
}

/**
 * Idempotent insert of a `pending` row. ON CONFLICT (the UNIQUE on
 * (group_id, joiner_user_id, state)) does nothing if a pending row already
 * exists — re-joins don't double-enqueue. Returns the row id (existing or
 * new) for the caller to thread through any immediate-dispatch attempt.
 */
export async function enqueueKeyshare(
  args: EnqueueKeyshareArgs,
): Promise<string | null> {
  const result = await query<{ id: string }>(
    `INSERT INTO pending_joins (group_id, joiner_user_id, joiner_device_id, state)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (group_id, joiner_user_id, state) DO UPDATE
       SET joiner_device_id = EXCLUDED.joiner_device_id,
           state_changed_at = NOW()
     RETURNING id`,
    [args.groupId, args.joinerUserId, args.joinerDeviceId],
  );
  return result.rows[0]?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────
// dispatchPendingKeysharesForUser — runs on socket connect
// ─────────────────────────────────────────────────────────────────

/**
 * For one online user, find every pending join in a group they're a
 * member of, atomically claim each, and emit `group:keyshare_request`.
 *
 * Joiner's public key is looked up live — handles the reinstall case
 * (their tombstoned old keypair won't surface, the latest active key
 * wins). If the joiner has NO active device key registered, the row is
 * left in `in_flight` (the row was claimed but no payload sent); the TTL
 * cron will reap it eventually. We could `UPDATE state = 'cancelled'` in
 * that case, but accepting the small wait is fine for v1.
 */
export async function dispatchPendingKeysharesForUser(
  courierUserId: string,
): Promise<number> {
  // Atomic claim: only flip rows where THIS user is a member of the join's
  // group AND the row is still `pending`. EXISTS-against-group_members
  // happens inside the SQL so we don't race a leave-then-courier scenario.
  // RETURNING gives us everything we need to look up the joiner's pubkey.
  const claimed = await query<PendingJoinRow>(
    `UPDATE pending_joins pj
        SET state = 'in_flight', state_changed_at = NOW()
       FROM (
         SELECT id FROM pending_joins
          WHERE state = 'pending'
            AND EXISTS (
              SELECT 1 FROM group_members gm
               WHERE gm.group_id = pending_joins.group_id
                 AND gm.user_id = $1
            )
            AND joiner_user_id <> $1
       ) AS eligible
      WHERE pj.id = eligible.id
   RETURNING pj.id, pj.group_id, pj.joiner_user_id, pj.joiner_device_id`,
    [courierUserId],
  );

  if (claimed.rows.length === 0) return 0;

  let emitted = 0;
  for (const row of claimed.rows) {
    // Look up the joiner's CURRENT active device public key. Most-recently-
    // seen, non-tombstoned. If they've reinstalled the row may reference
    // an old device_id that's been tombstoned — we encrypt to the new key
    // in that case.
    const keyLookup = await query<JoinerKeyRow>(
      `SELECT device_id, x25519_public_key
         FROM device_public_keys
        WHERE user_id = $1 AND tombstoned_at IS NULL
        ORDER BY last_seen DESC
        LIMIT 1`,
      [row.joiner_user_id],
    );
    const joinerKey = keyLookup.rows[0];
    if (!joinerKey) {
      // Joiner has no device key registered yet (race: they joined before
      // their device key registration POST landed). Leave the row in
      // `in_flight`; the next courier connect attempt will retry. If
      // nothing ever happens, TTL reaps it.
      continue;
    }

    const payload: KeyshareRequest = {
      v: 1,
      group_id: row.group_id,
      joiner_user_id: row.joiner_user_id,
      joiner_device_id: joinerKey.device_id,
      joiner_x25519_public_key_b64: joinerKey.x25519_public_key,
      pending_join_id: row.id,
    };
    // Emit to the courier's WHOLE user room (any of their devices can
    // serve). The first device to respond completes the handshake; later
    // POSTs by the same user against an already-`delivered` row are
    // silently no-op by markKeyshareDelivered's WHERE clause.
    emitToUser(courierUserId, 'group:keyshare_request', payload);
    emitted++;
  }

  logger.info('keyshare requests dispatched', {
    courier_count: 1,
    request_count: emitted,
  });

  return emitted;
}

// ─────────────────────────────────────────────────────────────────
// markKeyshareDelivered — called from the deliver route
// ─────────────────────────────────────────────────────────────────

export interface DeliverKeyshareArgs {
  pendingJoinId: string;
  joinerUserId: string;     // pulled from the row, used for the emit fan-out
  envelope: unknown;        // opaque to the server; we forward whole
}

/**
 * Flip pending → delivered (idempotent) and emit
 * `group:keyshare_envelope` to the joiner's device room. Returns whether
 * the row was actually flipped this call — false means another courier
 * already delivered, in which case the late courier's emit is suppressed
 * to avoid the joiner getting two envelopes.
 */
export async function markKeyshareDelivered(
  args: DeliverKeyshareArgs,
): Promise<{ deliveredThisCall: boolean }> {
  const update = await query<{ joiner_device_id: string }>(
    `UPDATE pending_joins
        SET state = 'delivered', state_changed_at = NOW()
      WHERE id = $1
        AND joiner_user_id = $2
        AND state IN ('pending', 'in_flight')
   RETURNING joiner_device_id`,
    [args.pendingJoinId, args.joinerUserId],
  );

  if (update.rows.length === 0) {
    return { deliveredThisCall: false };
  }

  // Emit to the joiner's whole user room rather than just the recorded
  // device_id — between join and delivery they may have registered a
  // newer device. Joiner-side client validates the envelope decrypts
  // before storing.
  emitToUser(args.joinerUserId, 'group:keyshare_envelope', args.envelope);

  logger.info('keyshare delivered', { pending_join_id_present: true });
  return { deliveredThisCall: true };
}

// ─────────────────────────────────────────────────────────────────
// Registration + cleanup
// ─────────────────────────────────────────────────────────────────

let registered = false;

export function registerKeyshareHub(): void {
  if (registered) return;
  registered = true;
  onUserConnect(async (userId) => {
    await dispatchPendingKeysharesForUser(userId);
  });
}

export async function expireStalePendingJoins(): Promise<number> {
  const result = await query(
    `UPDATE pending_joins
        SET state = 'expired', state_changed_at = NOW()
      WHERE state IN ('pending', 'in_flight')
        AND created_at < NOW() - INTERVAL '${TTL_DAYS} days'`,
  );
  return result.rowCount ?? 0;
}
