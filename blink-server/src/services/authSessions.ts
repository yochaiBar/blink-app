/**
 * Login sessions: one `auth_sessions` row per signed-in device.
 *
 * - The access token is a short-lived JWT `{ sub, sid }`. Every request and
 *   socket handshake re-checks that the session is still live, so revoking
 *   a session (logout, refresh-token reuse, account deletion) takes effect
 *   immediately.
 * - The refresh token is opaque: `<sid>.<secret>`. Only SHA-256(secret) is
 *   stored. Each refresh rotates it atomically.
 * - Rotation is deterministic: the next secret is HMAC(server key, sid +
 *   current hash). Two refreshes racing with the same token (e.g. parallel
 *   401 retries) therefore get the same new token, as long as the loser
 *   arrives within REFRESH_GRACE_SECONDS of the rotation. Any other reuse of
 *   an old token is treated as theft and revokes the session.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { env } from '../config/env';
import { JWT_ACCESS_EXPIRY } from '../utils/constants';
import { disconnectSession } from '../socket';
import logger from '../utils/logger';

const SESSION_TTL = "INTERVAL '7 days'";
export const REFRESH_GRACE_SECONDS = 30;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
}

export interface AccessClaims {
  userId: string;
  sid: string;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** The secret that follows `currentHash` for session `sid`. */
function nextSecret(sid: string, currentHash: string): string {
  return crypto.createHmac('sha256', env.JWT_REFRESH_SECRET).update(`${sid}:${currentHash}`).digest('base64url');
}

function signAccessToken(userId: string, sid: string): string {
  return jwt.sign({ sub: userId, sid }, env.JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRY });
}

/** Start a new session for `userId` and return its first token pair. */
export async function createSession(userId: string): Promise<SessionTokens> {
  const secret = crypto.randomBytes(32).toString('base64url');
  const result = await query<{ id: string }>(
    `INSERT INTO auth_sessions (user_id, refresh_hash, expires_at)
     VALUES ($1, $2, NOW() + ${SESSION_TTL})
     RETURNING id`,
    [userId, sha256(secret)],
  );
  const sid = result.rows[0].id;
  return { access_token: signAccessToken(userId, sid), refresh_token: `${sid}.${secret}` };
}

export type RefreshOutcome =
  { ok: true; tokens: SessionTokens; userId: string } | { ok: false; reason: 'invalid' | 'reused' };

/** Rotate a refresh token. See the file header for the grace/reuse rules. */
export async function rotateRefreshToken(refreshToken: string): Promise<RefreshOutcome> {
  const dot = refreshToken.indexOf('.');
  const sid = dot > 0 ? refreshToken.slice(0, dot) : '';
  const secret = dot > 0 ? refreshToken.slice(dot + 1) : '';
  if (!UUID_REGEX.test(sid) || !secret) return { ok: false, reason: 'invalid' };

  const presentedHash = sha256(secret);
  const next = nextSecret(sid, presentedHash);

  // Normal case: the presented token is current. Atomic, so concurrent
  // refreshes can't both rotate.
  const rotated = await query<{ user_id: string }>(
    `UPDATE auth_sessions
        SET prev_refresh_hash = refresh_hash,
            refresh_hash = $3,
            rotated_at = NOW(),
            expires_at = NOW() + ${SESSION_TTL}
      WHERE id = $1 AND refresh_hash = $2 AND revoked_at IS NULL AND expires_at > NOW()
      RETURNING user_id`,
    [sid, presentedHash, sha256(next)],
  );
  if (rotated.rows.length > 0) {
    const userId = rotated.rows[0].user_id;
    return {
      ok: true,
      userId,
      tokens: { access_token: signAccessToken(userId, sid), refresh_token: `${sid}.${next}` },
    };
  }

  // Lost a race within the grace window: hand back the same rotated token.
  const graced = await query<{ user_id: string }>(
    `SELECT user_id FROM auth_sessions
      WHERE id = $1 AND prev_refresh_hash = $2 AND refresh_hash = $3
        AND revoked_at IS NULL AND expires_at > NOW()
        AND rotated_at > NOW() - make_interval(secs => $4)`,
    [sid, presentedHash, sha256(next), REFRESH_GRACE_SECONDS],
  );
  if (graced.rows.length > 0) {
    const userId = graced.rows[0].user_id;
    return {
      ok: true,
      userId,
      tokens: { access_token: signAccessToken(userId, sid), refresh_token: `${sid}.${next}` },
    };
  }

  // Anything else on a live session is reuse of a stale token: revoke.
  const revoked = await revokeSession(sid, 'refresh_reuse');
  return { ok: false, reason: revoked ? 'reused' : 'invalid' };
}

/** Revoke one session and drop its sockets. Returns whether it was live. */
export async function revokeSession(sid: string, reason: string): Promise<boolean> {
  const result = await query(
    `UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
    [sid],
  );
  disconnectSession(sid);
  if (result.rows.length > 0) logger.info('Session revoked', { sid, reason });
  return result.rows.length > 0;
}

/**
 * Verify an access token and that its session is still live. Shared by the
 * HTTP `authenticate` middleware and the Socket.io handshake.
 */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    return null;
  }
  const userId = payload.sub;
  const sid = payload.sid;
  if (typeof userId !== 'string' || typeof sid !== 'string' || !UUID_REGEX.test(sid)) return null;

  const live = await query(
    `SELECT 1 FROM auth_sessions
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > NOW()`,
    [sid, userId],
  );
  return live.rows.length > 0 ? { userId, sid } : null;
}
