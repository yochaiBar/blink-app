import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';

let io: SocketServer | null = null;

export function initSocket(httpServer: HttpServer) {
  io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:8081', 'http://localhost:19006'],
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
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
      socket.data.userId = decoded.userId;
      next();
    } catch {
      next(new Error('Authentication error: invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug('Socket connected', { userId: socket.data.userId, socketId: socket.id });

    // Auto-join user's group rooms
    socket.on('join-groups', (groupIds: string[]) => {
      groupIds.forEach((id) => socket.join(`group:${id}`));
      logger.debug('User joined group rooms', { userId: socket.data.userId, groupIds });
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
export function emitToGroup(groupId: string, event: string, data: any) {
  if (io) {
    io.to(`group:${groupId}`).emit(event, data);
  }
}

export function getIO(): SocketServer | null {
  return io;
}
