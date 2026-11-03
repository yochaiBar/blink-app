/**
 * A real Blink server for integration tests: createApp() behind a real
 * http.Server with the real Socket.io layer, on a random local port.
 *
 * useTestServer() starts one server per test file and swaps in a fresh
 * createApp() before every test, so in-memory rate-limit counters never
 * carry over between tests.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import type { Express } from 'express';
import request from 'supertest';
import { io as connectClient, Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../../app';
import { initSocket, getIO } from '../../socket';
import { registerRelayHub } from '../../services/relayHub';
import { registerKeyshareHub } from '../../services/keyshareHub';

export interface TestServer {
  baseUrl: string;
  resetApp(): void;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  let app: Express = createApp();
  const server = http.createServer((req, res) => app(req, res));
  const io = initSocket(server);
  // Same wiring as server.ts.
  registerRelayHub();
  registerKeyshareHub();

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    resetApp() {
      app = createApp();
    },
    async close() {
      server.closeAllConnections();
      // io.close() also closes the attached http server.
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}

export function useTestServer() {
  let server: TestServer | undefined;
  const sockets: ClientSocket[] = [];

  function current(): TestServer {
    if (!server) throw new Error('Test server not started yet (use it inside a test or hook)');
    return server;
  }

  beforeAll(async () => {
    server = await startTestServer();
  });

  beforeEach(() => {
    current().resetApp();
  });

  afterEach(() => {
    for (const s of sockets.splice(0)) s.disconnect();
  });

  afterAll(async () => {
    await server?.close();
  });

  return {
    /** supertest bound to the running server. */
    api: () => request(current().baseUrl),
    get baseUrl() {
      return current().baseUrl;
    },
    /**
     * Connect an authenticated Socket.io client; resolves once the server
     * has accepted it. Disconnected automatically after each test.
     */
    async connectSocket(token: string): Promise<ClientSocket> {
      const socket = connectClient(current().baseUrl, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      return socket;
    },
  };
}

/** Wait until `count` sockets have joined a server-side room. */
export async function waitForRoomSize(room: string, count: number, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sockets = await getIO()?.in(room).fetchSockets();
    if ((sockets?.length ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} socket(s) in room ${room}`);
}
