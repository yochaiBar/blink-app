import { Router, Response } from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validate';
import { presignUploadSchema } from '../utils/schemas';
import logger from '../utils/logger';
import { PRESIGNED_URL_EXPIRY_SECONDS } from '../utils/constants';
import { v4 as uuid } from 'uuid';

const router = Router();

router.use(authenticate);

// ── S3 configuration check at startup ────────────────────────────
const AWS_REQUIRED_VARS = ['AWS_S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const;

function checkAwsConfig(): string[] {
  return AWS_REQUIRED_VARS.filter((key) => !process.env[key]);
}

const missingVars = checkAwsConfig();
if (missingVars.length > 0) {
  logger.warn(
    `S3 upload disabled: missing environment variables: ${missingVars.join(', ')}. ` +
    'Photo uploads will fall back to client-side base64 storage.'
  );
}

// Lazy-init S3 client (only created when AWS env vars are present)
let s3Client: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (s3Client) return s3Client;
  const { AWS_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env;
  if (!AWS_S3_BUCKET || !AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) return null;
  s3Client = new S3Client({
    region: AWS_REGION,
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
  });
  return s3Client;
}

// POST /api/upload/presign - Get a pre-signed S3 URL
router.post('/presign', validateBody(presignUploadSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { groupId, challengeId } = req.body;
  const photoId = uuid();
  const fileKey = `groups/${groupId}/${challengeId}/${photoId}/original.jpg`;

  const client = getS3Client();
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION;

  if (client && bucket && region) {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      ContentType: 'image/jpeg',
      Tagging: `userId=${req.userId}&groupId=${groupId}&challengeId=${challengeId}`,
    });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: PRESIGNED_URL_EXPIRY_SECONDS });
    const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${fileKey}`;

    logger.info('Presign URL generated (S3)', { fileKey, userId: req.userId });
    res.json({ uploadUrl, fileKey, publicUrl, dev_mode: false });
    return;
  }

  // Dev mode: no S3 configured -- client falls back to base64
  logger.warn('Presign URL skipped: S3 not configured (dev mode)', { userId: req.userId });
  res.json({ uploadUrl: null, fileKey: null, publicUrl: null, dev_mode: true });
}));

export default router;
