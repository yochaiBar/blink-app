import { create } from 'zustand';
import { api, setTokens, clearTokens, loadToken } from '@/services/api';

interface User {
  id: string;
  phone_number: string;
  display_name: string | null;
  avatar_url: string | null;
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
    const data = await api('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone_number: phone, code }),
    });
    await setTokens(data.accessToken, data.refreshToken);
    set({ user: data.user, isAuthenticated: true });
  },

  restoreSession: async () => {
    try {
      await loadToken();
      // Fetch user profile to validate token and populate user data
      const user = await api('/auth/me');
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ isAuthenticated: false, isLoading: false });
    }
  },

  logout: async () => {
    await clearTokens();
    set({ user: null, isAuthenticated: false });
  },

  updateName: (name: string) => {
    set((state) => ({
      user: state.user ? { ...state.user, display_name: name } : null,
    }));
  },
}));
