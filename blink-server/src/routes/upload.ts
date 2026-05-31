import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import logger from '../utils/logger';

// ─────────────────────────────────────────────────────────────────
// LEGACY /api/upload/* — DEAD ROUTES
//
// The v1 photo flow (presigned S3 uploads + server-encrypted-blob
// uploads + avatar presign) was retired in Phase 6 of the
// no-server-photo-storage plan. The v2 flow uses
// POST /api/photos/relay with bytes encrypted under a group key that
// lives only on member devices; the server never holds plaintext OR
// ciphertext.
//
// These routes remain ONLY to give old v1 app builds a clean
// "please update" signal. They return HTTP 426 Upgrade Required so
// the app can surface a forced-upgrade modal instead of a confusing
// 404 or 500.
//
// Delete these stubs entirely once telemetry shows zero hits.
// ─────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

function upgradeRequired(routeName: string) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    logger.info('legacy upload route hit (HTTP 426)', {
      route: routeName,
      userId: req.userId,
    });
    res.status(426).json({
      error:
        'This app version is no longer supported. Please update to the latest version of Blink.',
      upgrade_required: true,
    });
  });
}

router.post('/avatar-presign', upgradeRequired('avatar-presign'));
router.post('/presign', upgradeRequired('presign'));
router.post('/encrypted', upgradeRequired('encrypted'));

export default router;
