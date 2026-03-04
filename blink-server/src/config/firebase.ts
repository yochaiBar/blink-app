import admin from 'firebase-admin';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

// ── Firebase initialization ──────────────────────────────────────
// In production, FIREBASE_SERVICE_ACCOUNT must contain the JSON string
// of a Firebase service account key. When it is absent (local dev),
// Firebase is not initialized and the server falls back to dev-mode
// OTP (code 123456).

let firebaseApp: admin.app.App | null = null;
let firebaseConfigured = false;

try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (raw && raw.trim().length > 2) {
    // Attempt to parse the JSON service account key
    const serviceAccount = JSON.parse(raw);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseConfigured = true;
    logger.info('Firebase Admin SDK initialized successfully');
  } else {
    logger.warn(
      'FIREBASE_SERVICE_ACCOUNT is not set or empty. ' +
      'Firebase Phone Auth is disabled. Falling back to dev-mode OTP.'
    );
  }
} catch (error: any) {
  logger.error('Failed to initialize Firebase Admin SDK', {
    error: error.message,
  });
  logger.warn(
    'Firebase Phone Auth is disabled due to initialization error. ' +
    'Falling back to dev-mode OTP.'
  );
}

// ── Exported helpers ─────────────────────────────────────────────

/**
 * Whether Firebase Admin SDK was initialized successfully.
 * When false, the auth routes will use dev-mode OTP (123456).
 */
export const isFirebaseConfigured = firebaseConfigured;

/**
 * Verify a Firebase ID token returned by the client after completing
 * Firebase Phone Auth on the client side.
 *
 * Returns the decoded token which includes the phone number at
 * `decodedToken.phone_number`.
 *
 * Throws if the token is invalid, expired, or Firebase is not configured.
 */
export async function verifyFirebaseToken(
  idToken: string
): Promise<admin.auth.DecodedIdToken> {
  if (!firebaseApp) {
    throw new Error('Firebase is not configured');
  }
  return admin.auth().verifyIdToken(idToken);
}

export default firebaseApp;
