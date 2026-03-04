import { io, Socket } from 'socket.io-client';
import { API_URL, getAccessToken } from '@/services/api';

// Derive the base server URL by stripping the /api suffix
const SOCKET_URL = API_URL.replace(/\/api$/, '');

let socket: Socket | null = null;

/**
 * Connect to the Socket.io server using the current JWT token.
 * Safe to call multiple times -- reconnects only if not already connected.
 */
export function connectSocket(): Socket | null {
  const token = getAccessToken();
  if (!token) {
    if (__DEV__) console.warn('[Socket] No access token, skipping connect');
    return null;
  }

  // Already connected with the same token -- nothing to do
  if (socket?.connected) {
    return socket;
  }

  // Disconnect stale socket before creating a new one
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', () => {
    if (__DEV__) console.log('[Socket] Connected', socket?.id);
  });

  socket.on('connect_error', (err) => {
    if (__DEV__) console.warn('[Socket] Connection error:', err.message);
  });

  socket.on('disconnect', (reason) => {
    if (__DEV__) console.log('[Socket] Disconnected:', reason);
  });

  return socket;
}

/**
 * Disconnect the socket and clean up.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    if (__DEV__) console.log('[Socket] Manually disconnected');
  }
}

/**
 * Join a set of group rooms so we receive group-specific events.
 */
export function joinGroups(groupIds: string[]): void {
  if (socket?.connected && groupIds.length > 0) {
    socket.emit('join-groups', groupIds);
    if (__DEV__) console.log('[Socket] Joined groups:', groupIds);
  }
}

/**
 * Return the current socket instance (may be null).
 */
export function getSocket(): Socket | null {
  return socket;
}
