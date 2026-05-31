import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../middleware/validate';
import { relayPhotoSchema } from '../../utils/schemas';
import { dispatchPhoto } from '../../services/relayHub';
import type {
  RelayPhotoMetadata,
  RelayPhotoResult,
} from '../../shared/photoProtocol';

// ─────────────────────────────────────────────────────────────────
// POST /api/photos/relay
//
// Receives one encrypted photo from the sender's device and fans it out
// to the listed recipients via Socket.io. Bytes are passed straight to
// `dispatchPhoto` which holds them in memory only until each recipient
// has either ACKed (`photo:incoming`) or fallen to `pending_photo_pickups`.
// No disk write, no DB insert of bytes. See plan §"Phase 3".
//
// Privacy-safe logging
// ────────────────────
// `morgan.skip` already excludes /api/photos/* paths from the combined
// access log (Plan C2). Within this route we don't add any logs of our own;
// the relayHub emits one summary line with counts-only (no IDs). The
// `validateBody` middleware logs validation failures via the default 400
// path — that's path + reason, which is acceptable.
// ─────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

router.post(
  '/relay',
  validateBody(relayPhotoSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = req.body as RelayPhotoMetadata;

    const result = await dispatchPhoto({
      groupId: body.group_id,
      challengeId: body.challenge_id,
      responseId: body.response_id,
      senderUserId: req.userId!,
      senderDeviceId: body.sender_device_id,
      ivB64: body.iv_b64,
      authTagB64: body.auth_tag_b64,
      ciphertextB64: body.ciphertext_b64,
      recipientUserIds: body.recipient_user_ids,
      pickupId: body.pickup_id,
    });

    const response: RelayPhotoResult = {
      v: 1,
      delivered_user_ids: result.deliveredUserIds,
      queued_user_ids: result.queuedUserIds,
    };
    res.status(200).json(response);
  }),
);

export default router;
