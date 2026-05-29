import { Router, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validate';
import { registerDeviceKeySchema } from '../utils/schemas';
import { query } from '../config/database';
import logger from '../utils/logger';
import type {
  RegisterDeviceKeyRequest,
  RegisterDeviceKeyResponse,
} from '../shared/photoProtocol';

// ─────────────────────────────────────────────────────────────────
// E2E photo flow — device public key registration.
//
// Why this route exists
// ─────────────────────
// Each device generates a long-lived X25519 keypair on first launch. The
// private key stays in the device's secure storage forever; the public key
// is registered here so other group members can encrypt messages (currently:
// the group key during the courier handshake) to this device.
//
// Attestation model
// ─────────────────
// The body carries an `attestation_b64` field equal to
//     HMAC-SHA256(key = JWT-access-token-bytes, message = x25519_public_key_bytes)
// The server re-derives the HMAC with the access token from the Authorization
// header and compares (timing-safe). A different authenticated user cannot
// claim someone else's public key because each user's JWT is distinct.
//
// Limitations (honestly documented in the plan, §"Risks"):
//   - A fully-compromised server holds the JWT secret and CAN forge
//     attestations. This defends against client-side bugs, cross-user replay,
//     and certain MITM classes, not against root-level server compromise.
//   - End-to-end key authenticity (UI-visible fingerprints, out-of-band
//     verification) is a future enhancement.
//
// Tombstoning (Plan M3 guard)
// ───────────────────────────
// On reinstall, the device generates a fresh keypair. The OLD row is NOT
// deleted — couriers might still hold a reference to it during a race; we
// tombstone it so it's filtered out of active selection but the audit trail
// survives.
// ─────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim() || null;
}

function verifyAttestation(
  accessToken: string,
  publicKeyB64: string,
  providedAttestationB64: string,
): boolean {
  let providedBytes: Buffer;
  let publicKeyBytes: Buffer;
  try {
    providedBytes = Buffer.from(providedAttestationB64, 'base64');
    publicKeyBytes = Buffer.from(publicKeyB64, 'base64');
  } catch {
    return false;
  }
  // Both are HMAC-SHA256 outputs / X25519 public keys → 32 bytes each.
  if (providedBytes.length !== 32 || publicKeyBytes.length !== 32) {
    return false;
  }
  const expected = createHmac('sha256', Buffer.from(accessToken, 'utf8'))
    .update(publicKeyBytes)
    .digest();
  // timingSafeEqual requires equal-length buffers; we already checked length.
  return timingSafeEqual(expected, providedBytes);
}

// ── POST /api/device-keys — register (or rotate) a device public key ──
router.post(
  '/',
  validateBody(registerDeviceKeySchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = req.body as RegisterDeviceKeyRequest;
    const userId = req.userId!;

    const accessToken = extractBearerToken(req.headers.authorization);
    if (!accessToken) {
      // Should be unreachable — `authenticate` already required it. Defense
      // in depth so we never run the HMAC against an empty key.
      res.status(401).json({ error: 'Missing access token' });
      return;
    }

    if (
      !verifyAttestation(
        accessToken,
        body.x25519_public_key_b64,
        body.attestation_b64,
      )
    ) {
      logger.warn('Device key attestation rejected', {
        userId,
        deviceId: body.device_id,
      });
      res.status(400).json({ error: 'Attestation verification failed' });
      return;
    }

    // Tombstone any previously-active row for this (user, device) pair.
    // Then upsert. We do both in a single statement so a courier reading
    // mid-rotation either sees the old key or the new key, never neither.
    // The UNIQUE(user_id, device_id) constraint means there's at most one
    // row to tombstone — the ON CONFLICT clause handles re-registration of
    // an existing device_id by bumping key_version and clearing tombstone.
    const result = await query<{
      device_id: string;
      key_version: number;
      registered_at: string;
    }>(
      `INSERT INTO device_public_keys (
         user_id, device_id, x25519_public_key, attestation, key_version,
         last_seen, tombstoned_at
       )
       VALUES ($1, $2, $3, $4, 1, NOW(), NULL)
       ON CONFLICT (user_id, device_id) DO UPDATE
         SET x25519_public_key = EXCLUDED.x25519_public_key,
             attestation       = EXCLUDED.attestation,
             key_version       = device_public_keys.key_version + 1,
             last_seen         = NOW(),
             tombstoned_at     = NULL
       RETURNING device_id, key_version, registered_at`,
      [
        userId,
        body.device_id,
        body.x25519_public_key_b64,
        body.attestation_b64,
      ],
    );

    // Tombstone any OTHER (different device_id) active rows for this user —
    // M3 guidance treats reinstall as a new device, and the user's older
    // physical device is unlikely to come back. The "active device" pointer
    // is implicitly "most recent non-tombstoned row" via `last_seen DESC`.
    await query(
      `UPDATE device_public_keys
          SET tombstoned_at = NOW()
        WHERE user_id = $1
          AND device_id <> $2
          AND tombstoned_at IS NULL`,
      [userId, body.device_id],
    );

    const row = result.rows[0];
    logger.info('Device public key registered', {
      userId,
      deviceId: row.device_id,
      keyVersion: row.key_version,
    });

    const response: RegisterDeviceKeyResponse = {
      v: 1,
      device_id: row.device_id,
      key_version: row.key_version,
      registered_at: row.registered_at,
    };
    res.status(200).json(response);
  }),
);

export default router;
