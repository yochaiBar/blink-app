import { io, Socket } from 'socket.io-client';
import { API_URL, getAccessToken } from '@/services/api';
import { getOrCreateDeviceKey } from '@/services/groupCrypto';

// Derive the base server URL by stripping the /api suffix
const SOCKET_URL = API_URL.replace(/\/api$/, '');

let socket: Socket | null = null;

/**
 * Connect to the Socket.io server using the current JWT token.
 * Safe to call multiple times -- reconnects only if not already connected.
 *
 * The handshake also says which device this is, so the server can route
 * pickup requests to the device holding a photo. It's rebuilt on every
 * (re)connect, with the latest access token. The server puts the socket in
 * its group rooms itself.
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
    auth: (cb) => {
      const current = getAccessToken() ?? token;
      getOrCreateDeviceKey()
        .then(({ device_id }) => cb({ token: current, deviceId: device_id }))
        .catch(() => cb({ token: current }));
    },
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
 * Return the current socket instance (may be null).
 */
export function getSocket(): Socket | null {
  return socket;
}
