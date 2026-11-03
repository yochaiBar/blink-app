import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/authSessions';

export interface AuthRequest extends Request {
  userId?: string;
  /** The auth_sessions row this request's access token belongs to. */
  sessionId?: string;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    // JWT signature/expiry plus a live (not revoked, not expired) session.
    const claims = await verifyAccessToken(header.split(' ')[1]);
    if (!claims) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    req.userId = claims.userId;
    req.sessionId = claims.sid;
    next();
  } catch (err) {
    next(err);
  }
}
