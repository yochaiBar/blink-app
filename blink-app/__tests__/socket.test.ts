/**
 * services/socket — the handshake carries the current token and device, and
 * a refused handshake refreshes the session once and reconnects.
 */

import './setup';

import { connectSocket, disconnectSocket } from '../services/socket';

const mockRefreshSession = jest.fn();
let mockToken: string | null = 'token-1';
jest.mock('@/services/api', () => ({
  API_URL: 'http://localhost:3000/api',
  getAccessToken: () => mockToken,
  refreshSession: () => mockRefreshSession(),
}));
jest.mock('@/services/groupCrypto', () => ({ getOrCreateDeviceKey: async () => ({ device_id: 'dev-1' }) }));

type Listener = (...args: unknown[]) => void;
const mockSockets: {
  opts: { auth: (cb: (data: object) => void) => void };
  listeners: Map<string, Listener>;
  connect: jest.Mock;
}[] = [];
jest.mock('socket.io-client', () => ({
  io: (_url: string, opts: { auth: (cb: (data: object) => void) => void }) => {
    const listeners = new Map<string, Listener>();
    const socket = {
      opts,
      listeners,
      connected: false,
      connect: jest.fn(),
      disconnect: jest.fn(),
      on: (event: string, l: Listener) => listeners.set(event, l),
    };
    mockSockets.push(socket);
    return socket;
  },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockSockets.length = 0;
  mockRefreshSession.mockReset();
  mockToken = 'token-1';
  disconnectSocket();
});

describe('connectSocket', () => {
  it('sends the latest access token and the device id on every handshake', async () => {
    connectSocket();
    mockToken = 'token-2';
    const auth = await new Promise((resolve) => mockSockets[0].opts.auth(resolve));
    expect(auth).toEqual({ token: 'token-2', deviceId: 'dev-1' });
  });

  it('refreshes once and reconnects after the server refuses the token', async () => {
    connectSocket();
    const socket = mockSockets[0];
    mockRefreshSession.mockResolvedValue(true);

    socket.listeners.get('connect_error')!(new Error('Authentication error: invalid token'));
    await flush();
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);

    // Refused again before ever connecting: no second refresh (no loop).
    socket.listeners.get('connect_error')!(new Error('Authentication error: invalid token'));
    await flush();
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
  });

  it('ignores network errors and refreshes that fail', async () => {
    connectSocket();
    const socket = mockSockets[0];

    socket.listeners.get('connect_error')!(new Error('websocket error'));
    await flush();
    expect(mockRefreshSession).not.toHaveBeenCalled();

    mockRefreshSession.mockResolvedValue(false);
    socket.listeners.get('connect_error')!(new Error('Authentication error: invalid token'));
    await flush();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('survives a server restart: ignores "server down", then refreshes the expired token once and reconnects', async () => {
    connectSocket();
    const socket = mockSockets[0];
    mockRefreshSession.mockResolvedValue(true);

    // The server is restarting: transport errors, socket.io retries on its own.
    socket.listeners.get('connect_error')!(new Error('websocket error'));
    await flush();
    expect(mockRefreshSession).not.toHaveBeenCalled();

    // Back up, but the access token expired meanwhile.
    socket.listeners.get('connect_error')!(new Error('Authentication error: invalid token'));
    await flush();
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('tries again later when the refresh itself could not reach the server', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      connectSocket();
      const socket = mockSockets[0];
      mockRefreshSession.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      socket.listeners.get('connect_error')!(new Error('Authentication error: invalid token'));
      await Promise.resolve();
      await Promise.resolve();
      expect(socket.connect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(5_000);
      expect(socket.connect).toHaveBeenCalledTimes(1);

      // Refused again on that attempt: another refresh is allowed.
      socket.listeners.get('connect_error')!(new Error('Authentication error: invalid token'));
      await Promise.resolve();
      await Promise.resolve();
      expect(mockRefreshSession).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
