import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../middleware/validate';
import { relayPhotoSchema } from '../../utils/schemas';
import { dispatchPhoto } from '../../services/relayHub';
import type { RelayPhotoRequest, RelayPhotoResult } from '../../shared/photoProtocol';

// ─────────────────────────────────────────────────────────────────
// POST /api/photos/relay (protocol v2)
//
// Receives one encrypted photo from the sender's device and fans it out via
// Socket.io. The server decides group, challenge and recipients from the
// response (see relayHub.dispatchPhoto): the caller must own it, be a member
// and use the current group key version. Bytes are held in memory only
// until each recipient has ACKed or fallen to `pending_photo_pickups`.
//
// Privacy-safe logging: morgan skips /api/photos/*; the hub logs counts only.
// ─────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

router.post(
  '/relay',
  validateBody(relayPhotoSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = req.body as RelayPhotoRequest;

    const result = await dispatchPhoto({
      callerUserId: req.userId!,
      responseId: body.response_id,
      senderDeviceId: body.sender_device_id,
      keyVersion: body.key_version,
      ivB64: body.iv_b64,
      ciphertextB64: body.ciphertext_b64,
      pickupId: body.pickup_id,
    });

    const response: RelayPhotoResult = {
      v: 2,
      delivered_user_ids: result.deliveredUserIds,
      queued_user_ids: result.queuedUserIds,
    };
    res.status(200).json(response);
  }),
);

export default router;
