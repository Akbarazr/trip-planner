import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function firebaseOptions() {
  const value = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!value) return {};

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(value);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON');
  }

  return {
    credential: cert({
      ...serviceAccount,
      private_key: serviceAccount.private_key?.replace(/\\n/g, '\n'),
    }),
    projectId: serviceAccount.project_id,
  };
}

const app = getApps()[0] || initializeApp(firebaseOptions());

export const firebaseAuth = getAuth(app);
export const firestore = getFirestore(app);
