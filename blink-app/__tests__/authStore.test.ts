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
let api: any;
let setTokens: any;
let clearTokens: any;
let loadToken: any;

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

  // Re-require the modules to get fresh instances
  const apiModule = require('../services/api');
  const storeModule = require('../stores/authStore');

  useAuthStore = storeModule.useAuthStore;
  api = apiModule.api;
  setTokens = apiModule.setTokens;
  clearTokens = apiModule.clearTokens;
  loadToken = apiModule.loadToken;
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
  it('should request OTP via API in dev mode (no Firebase)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, {
      message: 'OTP sent',
      verificationId: 'dev-mode',
      dev_hint: 'Use 123456',
    }));

    const { requestOtp } = useAuthStore.getState();
    await requestOtp('+15551234567');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/request-otp'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone_number: '+15551234567' }),
      })
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
      avatar_url: null,
      bio: null,
    };

    mockFetch.mockResolvedValueOnce(mockResponse(200, {
      user: mockUser,
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-456',
    }));

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
    mockFetch.mockResolvedValueOnce(mockResponse(200, {
      user: { id: 'u1', phone_number: '+15551234567', display_name: null, avatar_url: null, bio: null },
      accessToken: 'at',
      refreshToken: 'rt',
    }));

    const { verifyOtp } = useAuthStore.getState();
    await verifyOtp('+15551234567', '123456');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/verify-otp'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone_number: '+15551234567', code: '123456' }),
      })
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
      avatar_url: null,
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

  it('should handle network errors gracefully', async () => {
    localStorage.setItem('accessToken', 'some-token');

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { restoreSession } = useAuthStore.getState();
    await restoreSession();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// logout
// ─────────────────────────────────────────────────────────────────
describe('logout', () => {
  it('should clear tokens and reset state', async () => {
    // Set up authenticated state first
    mockFetch.mockResolvedValueOnce(mockResponse(200, {
      user: { id: 'u1', phone_number: '+1', display_name: 'T', avatar_url: null, bio: null },
      accessToken: 'at',
      refreshToken: 'rt',
    }));

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

// ─────────────────────────────────────────────────────────────────
// updateName and updateBio
// ─────────────────────────────────────────────────────────────────
describe('Local State Updates', () => {
  beforeEach(async () => {
    // Set up authenticated state
    mockFetch.mockResolvedValueOnce(mockResponse(200, {
      user: { id: 'u1', phone_number: '+1', display_name: 'Original', avatar_url: null, bio: 'Original bio' },
      accessToken: 'at',
      refreshToken: 'rt',
    }));

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
