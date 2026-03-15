import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { env } from '../config/env';

export interface AuthRequest extends Request {
  userId?: string;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { userId: string };

    // Check if token has been revoked (e.g. account deletion)
    const revoked = await query('SELECT 1 FROM revoked_tokens WHERE user_id = $1 LIMIT 1', [payload.userId]);
    if (revoked.rows.length > 0) {
      res.status(401).json({ error: 'Token revoked' });
      return;
    }

    req.userId = payload.userId;
    next();
  } catch {
    // If it's already a response (from revoked check), don't overwrite
    if (res.headersSent) return;
    res.status(401).json({ error: 'Invalid token' });
  }
}
