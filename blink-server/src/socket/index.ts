import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';
import { query } from '../config/database';
import { env } from '../config/env';

let io: SocketServer | null = null;

// Phase 3 photo flow hook: relayHub subscribes here to dispatch
// pickup_requests when a recipient comes online. Decoupled so socket/index
// doesn't have to import photo-flow internals.
type UserConnectListener = (userId: string) => void | Promise<void>;
const userConnectListeners: UserConnectListener[] = [];

export function onUserConnect(cb: UserConnectListener): void {
  userConnectListeners.push(cb);
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function initSocket(httpServer: HttpServer) {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGINS?.split(',') || ['http://localhost:8081', 'http://localhost:19006'],
      credentials: true,
    },
    // Plan: raise from the 1MB default so binary fan-out frames for typical
    // 1–3 MB phone photos pass through without silently dropping the connection.
    // The app enforces a matching pre-encryption cap.
    maxHttpBufferSize: 8 * 1024 * 1024,
  });

  // Auth middleware - verify JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error: no token'));
    }
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string };
      socket.data.userId = decoded.userId;
      next();
    } catch {
      next(new Error('Authentication error: invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    logger.debug('Socket connected', { userId, socketId: socket.id });

    // Auto-join the per-user room so the photo flow can address recipients
    // by user_id without an explicit subscribe step. (group rooms still
    // require `join-groups` because they're DB-verified.)
    socket.join(`user:${userId}`);

    // Optional: client emits `register-device` after connect so we can
    // address a specific device for pickup_request (the one holding the
    // plaintext locally). Without it, pickup_request fans to all sender's
    // sockets; whichever device has the plaintext responds, others ignore.
    socket.on('register-device', (deviceId: string) => {
      if (typeof deviceId === 'string' && UUID_REGEX.test(deviceId)) {
        socket.data.deviceId = deviceId;
        socket.join(`user-device:${userId}:${deviceId}`);
      }
    });

    // Auto-join user's group rooms (verified against DB membership)
    socket.on('join-groups', async (groupIds: string[]) => {
      if (!Array.isArray(groupIds) || groupIds.length === 0) return;
      const validIds = groupIds.filter(id => typeof id === 'string' && UUID_REGEX.test(id));
      if (validIds.length === 0) return;
      try {
        const result = await query(
          'SELECT group_id FROM group_members WHERE user_id = $1 AND group_id = ANY($2::uuid[])',
          [userId, validIds]
        );
        const verifiedIds = result.rows.map((r) => r.group_id as string);
        verifiedIds.forEach((id: string) => socket.join(`group:${id}`));
      } catch (err) {
        console.error('Failed to verify group membership for socket', err);
      }
    });

    socket.on('disconnect', () => {
      logger.debug('Socket disconnected', { userId, socketId: socket.id });
    });

    // Fire connect listeners (e.g. relayHub dispatches pending pickups).
    // Each listener runs in a try/catch — a misbehaving one must not block
    // socket setup. We don't await; pickup dispatch is best-effort.
    for (const cb of userConnectListeners) {
      Promise.resolve(cb(userId)).catch((err) => {
        logger.error('userConnect listener failed', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  logger.info('Socket.io initialized');
  return io;
}

/**
 * Emit an event to all connected clients in a group room.
 */
export function emitToGroup(groupId: string, event: string, data: unknown) {
  if (io) {
    io.to(`group:${groupId}`).emit(event, data);
  }
}

/**
 * Emit to every socket of a specific user. Returns the number of sockets
 * the event was sent to (best-effort — Socket.io doesn't ACK on plain emit).
 */
export function emitToUser(userId: string, event: string, ...args: unknown[]): void {
  if (io) {
    io.to(`user:${userId}`).emit(event, ...args);
  }
}

/**
 * Emit to a specific device of a specific user, if it has joined its
 * device-specific room via `register-device`. Returns whether at least
 * one socket received the event.
 */
export function emitToUserDevice(
  userId: string,
  deviceId: string,
  event: string,
  ...args: unknown[]
): void {
  if (io) {
    io.to(`user-device:${userId}:${deviceId}`).emit(event, ...args);
  }
}

/**
 * Returns whether the given user has at least one connected socket.
 * Used by relayHub to decide deliver-now vs. queue-for-pickup.
 */
export async function isUserOnline(userId: string): Promise<boolean> {
  if (!io) return false;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  return sockets.length > 0;
}

/**
 * Emit an event to all sockets of a specific user and wait for ACK from
 * each. Resolves with the count of sockets that ACKed within the timeout.
 * Used by relayHub to confirm photo:incoming delivery before deciding
 * whether to queue a pending pickup.
 */
export async function emitToUserWithAck(
  userId: string,
  event: string,
  payload: unknown,
  timeoutMs = 30_000,
): Promise<{ acked: number; nacked: number; failed: number }> {
  if (!io) return { acked: 0, nacked: 0, failed: 0 };
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  if (sockets.length === 0) return { acked: 0, nacked: 0, failed: 0 };

  let acked = 0;
  let nacked = 0;
  let failed = 0;

  await Promise.all(
    sockets.map(async (s) => {
      try {
        const response = (await s.timeout(timeoutMs).emitWithAck(event, payload)) as
          | { ok: true }
          | { ok: false; error?: string }
          | undefined;
        if (response && response.ok === true) acked++;
        else nacked++;
      } catch {
        failed++; // includes timeouts
      }
    }),
  );

  return { acked, nacked, failed };
}

export function getIO(): SocketServer | null {
  return io;
}
