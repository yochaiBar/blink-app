import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import logger from '../utils/logger';
import { query } from '../config/database';
import { env } from '../config/env';
import { verifyAccessToken } from '../services/authSessions';

let io: SocketServer | null = null;

// Phase 3 photo flow hook: relayHub subscribes here to dispatch
// pickup_requests when a recipient comes online. Decoupled so socket/index
// doesn't have to import photo-flow internals.
type UserConnectListener = (userId: string) => void | Promise<void>;
const userConnectListeners: UserConnectListener[] = [];

export function onUserConnect(cb: UserConnectListener): void {
  userConnectListeners.push(cb);
}

// Fired once a socket has said which device it is (handshake `auth.deviceId`
// or `register-device`): from then on that device can be addressed, e.g. by
// pickup requests for photos only it holds.
type DeviceReadyListener = (userId: string, deviceId: string) => void | Promise<void>;
const deviceReadyListeners: DeviceReadyListener[] = [];

export function onDeviceReady(cb: DeviceReadyListener): void {
  deviceReadyListeners.push(cb);
}

function fireListeners<A extends unknown[]>(listeners: ((...args: A) => void | Promise<void>)[], ...args: A) {
  for (const cb of listeners) {
    Promise.resolve(cb(...args)).catch((err) => {
      logger.error('socket listener failed', { error: err instanceof Error ? err.message : String(err) });
    });
  }
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

  // Auth middleware: same check as HTTP authenticate (JWT + live session).
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error: no token'));
    }
    verifyAccessToken(token)
      .then((claims) => {
        if (!claims) return next(new Error('Authentication error: invalid token'));
        socket.data.userId = claims.userId;
        socket.data.sid = claims.sid;
        next();
      })
      .catch(() => next(new Error('Authentication error: invalid token')));
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    logger.debug('Socket connected', { userId, socketId: socket.id });

    // Per-user room so the photo flow can address recipients by user_id.
    socket.join(`user:${userId}`);
    // Per-session room so revoking a session (logout, token reuse) can drop
    // exactly that device's sockets.
    socket.join(`session:${socket.data.sid as string}`);

    // Group rooms are managed by the server: joined here for every group the
    // user is in, and updated on create / join / leave / delete via
    // joinGroupRoom, leaveGroupRoom and closeGroupRoom. Clients never pick
    // their own rooms.
    query<{ group_id: string }>('SELECT group_id FROM group_members WHERE user_id = $1', [userId])
      .then(({ rows }) => rows.forEach((r) => socket.join(`group:${r.group_id}`)))
      .catch((err: unknown) => {
        logger.error('Failed to join group rooms', { userId, error: err instanceof Error ? err.message : String(err) });
      });

    // The device this socket runs on, so pickups for photos only that device
    // holds can be routed to it. Sent in the handshake, or later via
    // `register-device` (older clients).
    const registerDevice = (deviceId: unknown) => {
      if (typeof deviceId !== 'string' || !UUID_REGEX.test(deviceId) || socket.data.deviceId === deviceId) return;
      socket.data.deviceId = deviceId;
      socket.join(`user-device:${userId}:${deviceId}`);
      fireListeners(deviceReadyListeners, userId, deviceId);
    };
    socket.on('register-device', registerDevice);

    socket.on('disconnect', () => {
      logger.debug('Socket disconnected', { userId, socketId: socket.id });
    });

    // Fire connect listeners (e.g. relayHub dispatches pending pickups).
    // Best-effort and not awaited; a failing listener can't block setup.
    fireListeners(userConnectListeners, userId);
    registerDevice(socket.handshake.auth.deviceId);
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
export function emitToUserDevice(userId: string, deviceId: string, event: string, ...args: unknown[]): void {
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
          { ok: true } | { ok: false; error?: string } | undefined;
        if (response && response.ok === true) acked++;
        else nacked++;
      } catch {
        failed++; // includes timeouts
      }
    }),
  );

  return { acked, nacked, failed };
}

/** Disconnect every socket opened under session `sid`. */
export function disconnectSession(sid: string): void {
  if (io) io.in(`session:${sid}`).disconnectSockets(true);
}

/** Disconnect every socket of `userId` (e.g. after account deletion). */
export function disconnectUser(userId: string): void {
  if (io) io.in(`user:${userId}`).disconnectSockets(true);
}

/** Emit to each listed user's sockets (e.g. a block-filtered audience). */
export function emitToUsers(userIds: string[], event: string, data: unknown): void {
  if (!io) return;
  for (const userId of userIds) io.to(`user:${userId}`).emit(event, data);
}

/** Is this specific device of `userId` connected (and registered)? */
export async function isDeviceOnline(userId: string, deviceId: string): Promise<boolean> {
  if (!io) return false;
  const sockets = await io.in(`user-device:${userId}:${deviceId}`).fetchSockets();
  return sockets.length > 0;
}

/** Put every socket of `userId` into the group's room (after create / join). */
export function joinGroupRoom(userId: string, groupId: string): void {
  if (io) io.in(`user:${userId}`).socketsJoin(`group:${groupId}`);
}

/** Take every socket of `userId` out of the group's room (after leaving). */
export function leaveGroupRoom(userId: string, groupId: string): void {
  if (io) io.in(`user:${userId}`).socketsLeave(`group:${groupId}`);
}

/** Empty a group's room (the group was deleted). */
export function closeGroupRoom(groupId: string): void {
  if (io) io.in(`group:${groupId}`).socketsLeave(`group:${groupId}`);
}
