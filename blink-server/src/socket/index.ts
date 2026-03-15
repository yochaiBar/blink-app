import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';
import { query } from '../config/database';
import { env } from '../config/env';

let io: SocketServer | null = null;

export function initSocket(httpServer: HttpServer) {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGINS?.split(',') || ['http://localhost:8081', 'http://localhost:19006'],
      credentials: true,
    },
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
    logger.debug('Socket connected', { userId: socket.data.userId, socketId: socket.id });

    // Auto-join user's group rooms (verified against DB membership)
    socket.on('join-groups', async (groupIds: string[]) => {
      if (!Array.isArray(groupIds) || groupIds.length === 0) return;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const validIds = groupIds.filter(id => typeof id === 'string' && uuidRegex.test(id));
      if (validIds.length === 0) return;
      try {
        const result = await query(
          'SELECT group_id FROM group_members WHERE user_id = $1 AND group_id = ANY($2::uuid[])',
          [socket.data.userId, validIds]
        );
        const verifiedIds = result.rows.map((r) => r.group_id as string);
        verifiedIds.forEach((id: string) => socket.join(`group:${id}`));
      } catch (err) {
        console.error('Failed to verify group membership for socket', err);
      }
    });

    socket.on('disconnect', () => {
      logger.debug('Socket disconnected', { userId: socket.data.userId, socketId: socket.id });
    });
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

export function getIO(): SocketServer | null {
  return io;
}
