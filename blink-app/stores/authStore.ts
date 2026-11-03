import { create } from 'zustand';
import { Platform } from 'react-native';
import { api, setTokens, clearTokens, loadToken } from '@/services/api';
import { sendPushTokenToServer } from '@/utils/notifications';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { clearDeviceKey } from '@/services/groupCrypto';
// photoStore is lazy-required inside logout() — it imports
// expo-file-system/legacy which needs the native module at runtime and
// would otherwise force every consumer of authStore to mock the FS.

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
  updateName: (name: string) => void;
  updateBio: (bio: string) => void;
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
    // E2E photo flow cleanup (Phase 6): nuke the device keypair AND every
    // cached photo. Old group keys in SecureStore become orphaned (we don't
    // index group IDs), but they're unreadable on next launch — a fresh
    // device keypair + fresh server-side handshake produces new keys.
    // Acceptable bounded leak for v1; can add a key index later if needed.
    try {
      // Lazy require so the module-level import doesn't drag
      // expo-file-system into every test that touches authStore.
      const { wipeAllPhotos } = await import('@/services/photoStore');
      await Promise.all([clearDeviceKey(), wipeAllPhotos()]);
    } catch {
      // Non-blocking — logout should always succeed locally even if
      // SecureStore / file deletion partially fails.
    }
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
