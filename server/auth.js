import { firebaseAuth } from './firebase.js';
import { useFirestore } from './storage.js';

const publicPath = (req) =>
  req.method === 'GET' && (
    req.path === '/api/health' ||
    req.path === '/health' ||
    /^\/(?:api\/)?shared\/[^/]+$/.test(req.path)
  );

export async function authenticate(req, res, next) {
  if (!useFirestore) {
    req.user = { uid: 'local' };
    return next();
  }

  const match = req.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    if (publicPath(req)) return next();
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.user = await firebaseAuth.verifyIdToken(match[1]);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}
