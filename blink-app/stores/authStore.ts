import { create } from 'zustand';
import { Platform } from 'react-native';
import { api, setTokens, clearTokens, loadToken } from '@/services/api';
import { sendPushTokenToServer } from '@/utils/notifications';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { clearEncryptionData } from '@/services/encryption';

interface User {
  id: string;
  phone_number: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

// Server-controlled feature flags returned from /auth/me. Read per-request
// on the server so ops can hot-rollback without forcing a client update;
// see blink-server/src/routes/auth.ts getFeatureFlags().
export interface FeatureFlags {
  photo_v2: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  // Default to FALSE app-side: if /auth/me hasn't returned flags yet (or
  // the server doesn't speak v2), the app stays on the v1 photo path
  // until the server explicitly opts in. Safer fallback than defaulting
  // to true and getting "photo arriving" placeholders that never resolve.
  photo_v2: false,
};

interface AuthState {
  user: User | null;
  featureFlags: FeatureFlags;
  isLoading: boolean;
  isAuthenticated: boolean;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  restoreSession: () => Promise<void>;
  logout: () => Promise<void>;
  updateName: (name: string) => void;
  updateBio: (bio: string) => void;
  updateAvatar: (avatarUrl: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  featureFlags: DEFAULT_FLAGS,
  isLoading: true,
  isAuthenticated: false,

  requestOtp: async (phone: string) => {
    await api('/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ phone_number: phone }),
    });
  },

  verifyOtp: async (phone: string, code: string) => {
    const data = await api<{ accessToken: string; refreshToken: string; user: User }>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone_number: phone, code }),
    });

    await setTokens(data.accessToken, data.refreshToken);
    set({ user: data.user, isAuthenticated: true });

    if (Platform.OS !== 'web') {
      sendPushTokenToServer();
    }

    // After auth, hit /auth/me to pull the server-side feature_flags.
    // /verify-otp returns only the user shape; flags live on /me.
    api<User & { feature_flags?: FeatureFlags }>('/auth/me')
      .then((me) => {
        if (me.feature_flags) {
          set({ featureFlags: { ...DEFAULT_FLAGS, ...me.feature_flags } });
        }
      })
      .catch(() => undefined);
  },

  restoreSession: async () => {
    try {
      await loadToken();
      const me = await api<User & { feature_flags?: FeatureFlags }>('/auth/me');
      const { feature_flags, ...user } = me;
      set({
        user,
        featureFlags: feature_flags
          ? { ...DEFAULT_FLAGS, ...feature_flags }
          : DEFAULT_FLAGS,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      // Session restore failed (expired token, network error) -- treat as logged out
      set({ isAuthenticated: false, isLoading: false });
    }
  },

  logout: async () => {
    await clearTokens();
    await clearEncryptionData();
    await useOnboardingStore.getState().reset();
    set({ user: null, featureFlags: DEFAULT_FLAGS, isAuthenticated: false });
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

  updateAvatar: (avatarUrl: string) => {
    set((state) => ({
      user: state.user ? { ...state.user, avatar_url: avatarUrl } : null,
    }));
  },
}));
