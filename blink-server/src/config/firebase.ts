import admin from 'firebase-admin';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

let firebaseApp: admin.app.App;

try {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : undefined;

  firebaseApp = admin.initializeApp({
    credential: serviceAccount
      ? admin.credential.cert(serviceAccount)
      : admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
} catch (error) {
  logger.warn('Firebase initialization skipped (no credentials configured)');
  firebaseApp = admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'blink-dev',
  });
}

export const firebaseAuth = admin.auth();
export default firebaseApp;
