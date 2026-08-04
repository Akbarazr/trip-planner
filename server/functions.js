import { onRequest } from 'firebase-functions/v2/https';

process.env.USE_FIRESTORE = 'true';

const { default: app } = await import('./index.js');

export const api = onRequest({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 120,
  minInstances: 0,
  maxInstances: 5,
  secrets: ['GROQ_API_KEY'],
}, app);
