import { create } from 'zustand';
import { Platform } from 'react-native';
import { api, setTokens, clearTokens, loadToken } from '@/services/api';
import { sendPushTokenToServer } from '@/utils/notifications';

interface User {
  id: string;
  phone_number: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

// Firebase auth module — set by initFirebaseAuth() in _layout.tsx
// when running in a dev build with native modules available.
let firebaseAuth: any = null;
let confirmationResult: any = null;

export function initFirebaseAuth(auth: any) {
  firebaseAuth = auth;
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
    if (firebaseAuth) {
      confirmationResult = await firebaseAuth().signInWithPhoneNumber(phone);
      return;
    }

    // Dev mode: server stores a predictable OTP (123456)
    await api('/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ phone_number: phone }),
    });
  },

  verifyOtp: async (phone: string, code: string) => {
    let data: any;

    if (confirmationResult) {
      await confirmationResult.confirm(code);
      const idToken = await firebaseAuth().currentUser?.getIdToken();
      if (!idToken) throw new Error('Failed to get Firebase ID token');

      data = await api('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ firebaseToken: idToken }),
      });
      confirmationResult = null;
    } else {
      data = await api('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ phone_number: phone, code }),
      });
    }

    await setTokens(data.accessToken, data.refreshToken);
    set({ user: data.user, isAuthenticated: true });

    // Register push token immediately after login (fire-and-forget)
    if (Platform.OS !== 'web') {
      sendPushTokenToServer();
    }
  },

  restoreSession: async () => {
    try {
      await loadToken();
      const user = await api('/auth/me');
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ isAuthenticated: false, isLoading: false });
    }
  },

  logout: async () => {
    if (firebaseAuth) {
      try {
        await firebaseAuth().signOut();
      } catch (err: unknown) {
        if (__DEV__) {
          console.warn('[AuthStore] Firebase signOut failed:', err instanceof Error ? err.message : err);
        }
      }
    }
    await clearTokens();
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
