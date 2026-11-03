import { create } from 'zustand';
import { Platform } from 'react-native';
import { api, setTokens, clearTokens, loadToken, onSessionExpired } from '@/services/api';
import { sendPushTokenToServer } from '@/utils/notifications';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { clearDeviceKey, wipeAllGroupKeys } from '@/services/groupCrypto';
import { wipeAllPins } from '@/services/keyPins';
// photoStore and relayRetry are lazy-required in wipeLocalData() — they
// import expo-file-system/legacy, which needs the native module at runtime
// and would otherwise force every consumer of authStore to mock the FS.

interface User {
  id: string;
  phone_number: string;
  display_name: string | null;
  bio: string | null;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  restoreSession: () => Promise<void>;
  logout: () => Promise<void>;
  /** Delete the account on the server, then wipe this device. Throws (and stays signed in) if the server refuses. */
  deleteAccount: () => Promise<void>;
  updateName: (name: string) => void;
  updateBio: (bio: string) => void;
}

/**
 * Forget everything this account left on the device: the device keypair,
 * every group key, key pins, queued relays and every cached photo. Each
 * step is best-effort, so one failure can't keep the rest.
 */
async function wipeLocalData(): Promise<void> {
  await Promise.allSettled([
    clearDeviceKey(),
    wipeAllGroupKeys(),
    wipeAllPins(),
    import('@/services/relayRetry').then((m) => m.clearRelayRetries()),
    import('@/services/photoStore').then((m) => m.wipeAllPhotos()),
  ]);
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  requestOtp: async (phone: string) => {
    await api('/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ phone_number: phone }),
    });
  },

  verifyOtp: async (phone: string, code: string) => {
    const data = await api<{ access_token: string; refresh_token: string; user: User }>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone_number: phone, code }),
    });

    await setTokens(data.access_token, data.refresh_token);
    set({ user: data.user, isAuthenticated: true });

    if (Platform.OS !== 'web') {
      sendPushTokenToServer();
    }
  },

  restoreSession: async () => {
    try {
      await loadToken();
      const user = await api<User>('/auth/me');
      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      // Session restore failed (expired token, network error) -- treat as logged out
      set({ isAuthenticated: false, isLoading: false });
    }
  },

  logout: async () => {
    // End this device's server session first (revokes its refresh token and
    // drops its sockets); local logout still proceeds if the call fails.
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await clearTokens();
    await wipeLocalData();
    await useOnboardingStore.getState().reset();
    set({ user: null, isAuthenticated: false });
  },

  deleteAccount: async () => {
    // Throws on failure: the caller shows the error and the user stays
    // signed in, rather than looking deleted while the account survives.
    await api('/auth/delete-account', { method: 'DELETE' });
    // The server dropped every session with the account; no /logout call.
    await clearTokens();
    await wipeLocalData();
    await useOnboardingStore.getState().reset();
    set({ user: null, isAuthenticated: false });
  },

  updateName: (name: string) => {
    set((state) => ({
      user: state.user ? { ...state.user, display_name: name } : null,
    }));
  },

  updateBio: (bio: string) => {
    set((state) => ({
      user: state.user ? { ...state.user, bio } : null,
    }));
  },
}));

// The server refused our refresh token (revoked, expired or reused): the
// session is over on every screen, so sign out and wipe like a logout.
onSessionExpired(() => {
  if (useAuthStore.getState().isAuthenticated) void useAuthStore.getState().logout();
});
