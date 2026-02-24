import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import logger from '../utils/logger';
import { v4 as uuid } from 'uuid';

const router = Router();

router.use(authenticate);

// POST /api/upload/presign - Get a pre-signed S3 URL
// For MVP/dev: we return a mock URL. Replace with real S3 in production.
router.post('/presign', asyncHandler(async (req: AuthRequest, res: Response) => {
  const fileKey = `photos/${uuid()}.jpg`;

  if (process.env.AWS_S3_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
    // TODO: Real S3 pre-signed URL generation
    // const s3 = new S3Client({ region: process.env.AWS_REGION });
    // const command = new PutObjectCommand({ Bucket, Key: fileKey });
    // const url = await getSignedUrl(s3, command, { expiresIn: 300 });
    logger.info('Presign URL generated (S3)', { fileKey, userId: req.userId });
    res.json({ uploadUrl: `https://${process.env.AWS_S3_BUCKET}.s3.amazonaws.com/${fileKey}`, fileKey });
    return;
  }

  // Dev mode: return a placeholder URL (photos will be stored as base64 data URIs on client)
  logger.info('Presign URL generated (dev mode)', { fileKey, userId: req.userId });
  res.json({
    uploadUrl: null,
    fileKey,
    dev_mode: true,
    message: 'S3 not configured. Store photo_url as base64 data URI in challenge response.',
  });
}));

export default router;
