/**
 * Auth Store Tests - blink-app
 *
 * Tests the Zustand auth store which manages:
 * - OTP request flow (dev mode)
 * - OTP verification and token storage
 * - Session restoration from stored tokens
 * - Logout and token cleanup
 * - Local state updates (updateName, updateBio)
 */

import './setup';

// Reset the module registry to get a fresh store per test file
// We need to be careful with Zustand stores in tests
let useAuthStore: any;

const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

function mockResponse(status: number, body: any, ok?: boolean) {
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

beforeEach(() => {
  jest.resetModules();

  // Re-require the store (and with it a fresh services/api) per test
  const storeModule = require('../stores/authStore');

  useAuthStore = storeModule.useAuthStore;
});

// ─────────────────────────────────────────────────────────────────
// Initial State
// ─────────────────────────────────────────────────────────────────
describe('Initial State', () => {
  it('should have null user initially', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
  });

  it('should be loading initially', () => {
    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(true);
  });

  it('should not be authenticated initially', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// requestOtp
// ─────────────────────────────────────────────────────────────────
describe('requestOtp', () => {
  it('should request OTP via server API', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        message: 'OTP sent',
        verificationId: 'dev-mode',
        dev_hint: 'Use 123456',
      }),
    );

    const { requestOtp } = useAuthStore.getState();
    await requestOtp('+15551234567');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/request-otp'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone_number: '+15551234567' }),
      }),
    );
  });

  it('should throw error when OTP request fails', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'Invalid phone' }, false));

    const { requestOtp } = useAuthStore.getState();
    await expect(requestOtp('invalid')).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────
// verifyOtp
// ─────────────────────────────────────────────────────────────────
describe('verifyOtp', () => {
  it('should verify OTP, store tokens, and set authenticated state', async () => {
    const mockUser = {
      id: 'user-1',
      phone_number: '+15551234567',
      display_name: 'Test User',
      bio: null,
    };

    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        user: mockUser,
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-456',
      }),
    );

    const { verifyOtp } = useAuthStore.getState();
    await verifyOtp('+15551234567', '123456');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.isAuthenticated).toBe(true);

    // Tokens should be stored
    expect(localStorage.getItem('accessToken')).toBe('access-token-123');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-token-456');
  });

  it('should throw error when verification fails', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'Invalid OTP' }, false));

    const { verifyOtp } = useAuthStore.getState();
    await expect(verifyOtp('+15551234567', '000000')).rejects.toThrow('Invalid OTP');
  });

  it('should send phone_number and code in dev mode body', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        user: { id: 'u1', phone_number: '+15551234567', display_name: null, bio: null },
        access_token: 'at',
        refresh_token: 'rt',
      }),
    );

    const { verifyOtp } = useAuthStore.getState();
    await verifyOtp('+15551234567', '123456');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/verify-otp'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone_number: '+15551234567', code: '123456' }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// restoreSession
// ─────────────────────────────────────────────────────────────────
describe('restoreSession', () => {
  it('should restore session when valid token exists', async () => {
    // Pre-store a token
    localStorage.setItem('accessToken', 'stored-token');

    const mockUser = {
      id: 'user-1',
      phone_number: '+15551234567',
      display_name: 'Restored User',
      bio: null,
    };

    mockFetch.mockResolvedValueOnce(mockResponse(200, mockUser));

    const { restoreSession } = useAuthStore.getState();
    await restoreSession();

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  it('should set unauthenticated state when no stored token', async () => {
    // Ensure no tokens
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');

    mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'No token' }, false));

    const { restoreSession } = useAuthStore.getState();
    await restoreSession();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  it('should set unauthenticated state when /me endpoint fails', async () => {
    localStorage.setItem('accessToken', 'expired-token');

    // /me fails with 401 (token expired)
    mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'Expired' }, false));
    // refresh also fails (no refresh token stored)
    // Since clearTokens removed the token, no retry
    // Actually the api() function would try refresh, which would also 401

    const { restoreSession } = useAuthStore.getState();
    await restoreSession();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  it('keeps the session when the server is unreachable at app start, and says so', async () => {
    localStorage.setItem('accessToken', 'some-token');
    localStorage.setItem('refreshToken', 'some-refresh');
    mockFetch.mockRejectedValue(new TypeError('Network request failed'));

    await useAuthStore.getState().restoreSession();

    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.isOffline).toBe(true);
    // Not signed out: the tokens stay, so a retry can restore the session.
    expect(localStorage.getItem('accessToken')).toBe('some-token');
    expect(localStorage.getItem('refreshToken')).toBe('some-refresh');
    mockFetch.mockReset();
  });

  it('signs back in on a retry once the server is reachable again', async () => {
    localStorage.setItem('accessToken', 'some-token');
    localStorage.setItem('refreshToken', 'some-refresh');
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    await useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().isOffline).toBe(true);

    mockFetch.mockResolvedValueOnce(mockResponse(200, { id: 'u1', phone_number: '+1', display_name: 'T', bio: null }));
    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, isOffline: false });
  });
});

describe('the session survives everything but a rejected refresh', () => {
  const me = { id: 'u1', phone_number: '+1', display_name: 'T', bio: null };
  const route = (handlers: Record<string, () => Response>) =>
    mockFetch.mockImplementation(async (url) => {
      const path = String(url).replace(/^.*\/api/, '');
      const handler = handlers[path];
      if (!handler) throw new Error(`unexpected ${path}`);
      return handler();
    });

  beforeEach(() => {
    mockFetch.mockReset();
    localStorage.setItem('accessToken', 'expired-access');
    localStorage.setItem('refreshToken', 'refresh-1');
  });

  it('expired access token at app start: refreshes and signs in', async () => {
    let meCalls = 0;
    route({
      '/auth/me': () => (++meCalls === 1 ? mockResponse(401, {}, false) : mockResponse(200, me)),
      '/auth/refresh': () => mockResponse(200, { access_token: 'access-2', refresh_token: 'refresh-2' }),
    });

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, isOffline: false });
    expect(localStorage.getItem('refreshToken')).toBe('refresh-2');
  });

  it('only a refresh token stored at app start: refreshes and signs in', async () => {
    localStorage.removeItem('accessToken');
    route({
      '/auth/refresh': () => mockResponse(200, { access_token: 'access-2', refresh_token: 'refresh-2' }),
      // Like the server: /me needs a valid access token.
      '/auth/me': () => {
        const [, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
        return auth === 'Bearer access-2' ? mockResponse(200, me) : mockResponse(401, {}, false);
      },
    });

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, isOffline: false });
  });

  it('a 5xx at app start keeps the session', async () => {
    route({ '/auth/me': () => mockResponse(503, { error: 'Service Unavailable' }, false) });

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, isOffline: true });
    expect(localStorage.getItem('refreshToken')).toBe('refresh-1');
  });

  it('a server restart while signed in (401s, then a successful refresh) keeps the session through a reload', async () => {
    const { setTokens, api } = require('../services/api');
    await setTokens('expired-access', 'refresh-1');
    route({
      '/groups': () =>
        mockFetch.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh')).length === 0
          ? mockResponse(401, {}, false)
          : mockResponse(200, []),
      '/auth/refresh': () => mockResponse(200, { access_token: 'access-2', refresh_token: 'refresh-2' }),
      '/auth/me': () => mockResponse(200, me),
    });
    await Promise.all([api('/groups'), api('/groups'), api('/groups')]);

    // The JS reloads: a fresh store reads what's stored.
    jest.resetModules();
    const reloaded = require('../stores/authStore').useAuthStore;
    await reloaded.getState().restoreSession();

    expect(reloaded.getState()).toMatchObject({ isAuthenticated: true, isOffline: false });
    expect(localStorage.getItem('accessToken')).toBe('access-2');
  });

  it('only a refresh the server rejects signs out', async () => {
    route({
      '/auth/me': () => mockResponse(401, {}, false),
      '/auth/refresh': () => mockResponse(401, { error: 'Invalid refresh token' }, false),
      '/auth/logout': () => mockResponse(401, {}, false),
    });

    await useAuthStore.getState().restoreSession();
    await new Promise((resolve) => setTimeout(resolve, 0)); // the logout it triggers

    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, isOffline: false });
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// logout
// ─────────────────────────────────────────────────────────────────
describe('logout', () => {
  it('should clear tokens and reset state', async () => {
    // Set up authenticated state first
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        user: { id: 'u1', phone_number: '+1', display_name: 'T', bio: null },
        access_token: 'at',
        refresh_token: 'rt',
      }),
    );

    const { verifyOtp, logout } = useAuthStore.getState();
    await verifyOtp('+15551234567', '123456');

    // Now logout
    await logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });
});

describe('setPushEnabled', () => {
  async function signedIn() {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        user: { id: 'u1', phone_number: '+1', display_name: 'T', bio: null, push_enabled: true },
        access_token: 'at',
        refresh_token: 'rt',
      }),
    );
    await useAuthStore.getState().verifyOtp('+15551234567', '123456');
  }

  it('saves the choice on the server', async () => {
    await signedIn();
    mockFetch.mockResolvedValueOnce(mockResponse(200, { id: 'u1', push_enabled: false }));

    await useAuthStore.getState().setPushEnabled(false);

    expect(useAuthStore.getState().user.push_enabled).toBe(false);
    const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    expect(String(url)).toMatch(/\/auth\/profile$/);
    expect(init).toMatchObject({ method: 'PATCH', body: JSON.stringify({ push_enabled: false }) });
  });

  it('reverts and throws when the server refuses', async () => {
    await signedIn();
    mockFetch.mockResolvedValueOnce(mockResponse(500, { error: 'nope' }, false));

    await expect(useAuthStore.getState().setPushEnabled(false)).rejects.toThrow('nope');

    expect(useAuthStore.getState().user.push_enabled).toBe(true);
  });
});

describe('deleteAccount', () => {
  async function signedIn() {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        user: { id: 'u1', phone_number: '+1', display_name: 'T', bio: null },
        access_token: 'at',
        refresh_token: 'rt',
      }),
    );
    await useAuthStore.getState().verifyOtp('+15551234567', '123456');
  }

  it('stays signed in, with its tokens, when the server refuses', async () => {
    await signedIn();
    mockFetch.mockResolvedValueOnce(mockResponse(500, { error: 'Internal server error' }, false));

    await expect(useAuthStore.getState().deleteAccount()).rejects.toThrow('Internal server error');

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(localStorage.getItem('refreshToken')).toBe('rt');
  });

  it('signs out and clears the tokens once the account is gone', async () => {
    await signedIn();
    mockFetch.mockResolvedValueOnce(mockResponse(200, { message: 'Account deleted successfully' }));

    await useAuthStore.getState().deleteAccount();

    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false });
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    const calls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(calls.some((u) => u.endsWith('/auth/delete-account'))).toBe(true);
    expect(calls.some((u) => u.endsWith('/auth/logout'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// updateName and updateBio
// ─────────────────────────────────────────────────────────────────
describe('Local State Updates', () => {
  beforeEach(async () => {
    // Set up authenticated state
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        user: { id: 'u1', phone_number: '+1', display_name: 'Original', bio: 'Original bio' },
        access_token: 'at',
        refresh_token: 'rt',
      }),
    );

    const { verifyOtp } = useAuthStore.getState();
    await verifyOtp('+15551234567', '123456');
  });

  it('should update display_name locally', () => {
    const { updateName } = useAuthStore.getState();
    updateName('New Name');

    const state = useAuthStore.getState();
    expect(state.user?.display_name).toBe('New Name');
  });

  it('should update bio locally', () => {
    const { updateBio } = useAuthStore.getState();
    updateBio('New bio');

    const state = useAuthStore.getState();
    expect(state.user?.bio).toBe('New bio');
  });

  it('should not crash when updating name with no user', () => {
    // Logout first
    useAuthStore.setState({ user: null });

    const { updateName } = useAuthStore.getState();
    updateName('Test');

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
  });

  it('should not crash when updating bio with no user', () => {
    useAuthStore.setState({ user: null });

    const { updateBio } = useAuthStore.getState();
    updateBio('Test bio');

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
  });

  it('should preserve other user fields when updating name', () => {
    const { updateName } = useAuthStore.getState();
    updateName('Updated');

    const state = useAuthStore.getState();
    expect(state.user?.id).toBe('u1');
    expect(state.user?.phone_number).toBe('+1');
    expect(state.user?.bio).toBe('Original bio');
  });
});
