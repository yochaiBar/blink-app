import {
  RekognitionClient,
  DetectModerationLabelsCommand,
  type ModerationLabel,
} from '@aws-sdk/client-rekognition';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { query } from '../config/database';
import logger from '../utils/logger';

// ── Types ───────────────────────────────────────────────────────
export interface ModerationResult {
  safe: boolean;
  labels: string[];
  confidence: number;
}

// ── Configuration ───────────────────────────────────────────────

/** Feature gate: when false, all images pass moderation. */
function isEnabled(): boolean {
  return process.env.CONTENT_MODERATION_ENABLED === 'true';
}

/** Confidence threshold (0-100). Labels below this are ignored. */
function getThreshold(): number {
  const val = parseInt(process.env.MODERATION_CONFIDENCE_THRESHOLD || '75', 10);
  return isNaN(val) ? 75 : val;
}

// Categories that should cause rejection.
// Maps to AWS Rekognition top-level and second-level label taxonomy.
const BLOCKED_CATEGORIES = new Set([
  'Explicit Nudity',
  'Nudity',
  'Suggestive',
  'Violence',
  'Visually Disturbing',
  'Drugs',
  'Tobacco',
  'Alcohol',
  'Gambling',
  'Hate Symbols',
  'Drugs & Tobacco',
  'Drugs & Tobacco & Alcohol',
  'Rude Gestures',
]);

// ── Lazy-initialised clients ────────────────────────────────────

let rekognitionClient: RekognitionClient | null = null;
let s3Client: S3Client | null = null;

function getRekognitionClient(): RekognitionClient | null {
  if (rekognitionClient) return rekognitionClient;
  const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env;
  if (!AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) return null;
  rekognitionClient = new RekognitionClient({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
  });
  return rekognitionClient;
}

function getS3Client(): S3Client | null {
  if (s3Client) return s3Client;
  const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env;
  if (!AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) return null;
  s3Client = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

// ── Core moderation function ────────────────────────────────────

/**
 * Analyse an S3 image for content moderation violations.
 *
 * When `CONTENT_MODERATION_ENABLED` is not `'true'`, always returns safe.
 * When AWS credentials are missing, logs a warning and returns safe
 * (fail-open so local development is not blocked).
 */
export async function moderateImage(s3Key: string): Promise<ModerationResult> {
  // Feature gate
  if (!isEnabled()) {
    return { safe: true, labels: [], confidence: 0 };
  }

  const client = getRekognitionClient();
  if (!client) {
    logger.warn('Content moderation enabled but AWS credentials are missing; skipping check');
    return { safe: true, labels: [], confidence: 0 };
  }

  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) {
    logger.warn('Content moderation enabled but AWS_S3_BUCKET is not set; skipping check');
    return { safe: true, labels: [], confidence: 0 };
  }

  const threshold = getThreshold();

  try {
    const command = new DetectModerationLabelsCommand({
      Image: {
        S3Object: {
          Bucket: bucket,
          Name: s3Key,
        },
      },
      MinConfidence: threshold,
    });

    const response = await client.send(command);
    const moderationLabels: ModerationLabel[] = response.ModerationLabels || [];

    // Filter to labels that match our blocked categories
    const flaggedLabels = moderationLabels.filter((label) => {
      const name = label.Name || '';
      const parent = label.ParentName || '';
      return BLOCKED_CATEGORIES.has(name) || BLOCKED_CATEGORIES.has(parent);
    });

    const highestConfidence = flaggedLabels.reduce(
      (max, label) => Math.max(max, label.Confidence || 0),
      0
    );

    const labelNames = flaggedLabels.map(
      (l) => `${l.Name} (${(l.Confidence || 0).toFixed(1)}%)`
    );

    const safe = flaggedLabels.length === 0;

    if (!safe) {
      logger.warn('Image flagged by content moderation', {
        s3Key,
        labels: labelNames,
        confidence: highestConfidence,
      });
    } else {
      logger.debug('Image passed content moderation', { s3Key });
    }

    return {
      safe,
      labels: labelNames,
      confidence: highestConfidence,
    };
  } catch (err: any) {
    // Fail open: if Rekognition is unavailable, let the image through
    // but log the error so operators are aware.
    logger.error('Content moderation check failed; allowing image through', {
      s3Key,
      error: err.message,
    });
    return { safe: true, labels: [], confidence: 0 };
  }
}

// ── Helper: delete a flagged S3 object ──────────────────────────

export async function deleteS3Object(s3Key: string): Promise<void> {
  const client = getS3Client();
  const bucket = process.env.AWS_S3_BUCKET;
  if (!client || !bucket) return;

  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: s3Key })
    );
    logger.info('Deleted flagged S3 object', { s3Key });
  } catch (err: any) {
    logger.error('Failed to delete flagged S3 object', {
      s3Key,
      error: err.message,
    });
  }
}

// ── Helper: extract S3 key from a full S3 URL ──────────────────

/**
 * Given a URL like `https://bucket.s3.region.amazonaws.com/groups/abc/def/id/original.jpg`
 * returns `groups/abc/def/id/original.jpg`.
 * Returns `null` if the URL is not an S3 URL (e.g. base64 data URI).
 */
export function extractS3Key(photoUrl: string): string | null {
  if (!photoUrl || photoUrl.startsWith('data:')) return null;

  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) return null;

  // Pattern: https://<bucket>.s3.<region>.amazonaws.com/<key>
  const prefix = `https://${bucket}.s3.`;
  if (photoUrl.startsWith(prefix)) {
    const afterPrefix = photoUrl.slice(prefix.length);
    // Skip "region.amazonaws.com/"
    const slashIdx = afterPrefix.indexOf('/');
    if (slashIdx === -1) return null;
    const afterRegionHost = afterPrefix.slice(slashIdx);
    // afterRegionHost starts with ".amazonaws.com/<key>"
    const keyStart = afterRegionHost.indexOf('/', afterRegionHost.indexOf('.amazonaws.com'));
    if (keyStart === -1) return null;
    return decodeURIComponent(afterRegionHost.slice(keyStart + 1));
  }

  // Alternative pattern: https://s3.<region>.amazonaws.com/<bucket>/<key>
  if (photoUrl.includes('.amazonaws.com/')) {
    const url = new URL(photoUrl);
    const pathParts = url.pathname.split('/');
    // Remove leading empty string and bucket name
    if (pathParts.length > 2 && pathParts[1] === bucket) {
      return decodeURIComponent(pathParts.slice(2).join('/'));
    }
    // Virtual-hosted style: bucket is in hostname, key is the full path
    if (url.hostname.startsWith(bucket)) {
      return decodeURIComponent(url.pathname.slice(1));
    }
  }

  return null;
}

// ── Moderation logging ──────────────────────────────────────────

/**
 * Persist a moderation result to the `content_moderation_log` table.
 */
export async function logModerationResult(
  userId: string,
  s3Key: string,
  result: ModerationResult
): Promise<void> {
  try {
    await query(
      `INSERT INTO content_moderation_log (user_id, content_type, s3_key, safe, labels, confidence)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, 'image', s3Key, result.safe, JSON.stringify(result.labels), result.confidence]
    );
  } catch (err: any) {
    // Don't let logging failure break the request flow
    logger.error('Failed to log moderation result', {
      userId,
      s3Key,
      error: err.message,
    });
  }
}
