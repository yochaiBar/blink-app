import { create } from 'zustand';
import { Platform } from 'react-native';

type TourStep = 'home' | 'group_detail' | 'fab' | null;

interface OnboardingState {
  tourComplete: boolean;
  tourStep: TourStep;
  startTour: () => void;
  advanceTour: (step: TourStep) => void;
  completeTour: () => void;
  hydrate: () => Promise<void>;
}

const STORAGE_KEY = 'onboarding_tour_complete';

const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    const SecureStore = await import('expo-secure-store');
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(key, value);
  },
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  tourComplete: false,
  tourStep: null,

  startTour: () => {
    set({ tourStep: 'home' });
  },

  advanceTour: (step: TourStep) => {
    set({ tourStep: step });
  },

  completeTour: () => {
    set({ tourComplete: true, tourStep: null });
    storage.set(STORAGE_KEY, 'true');
  },

  hydrate: async () => {
    const value = await storage.get(STORAGE_KEY);
    if (value === 'true') {
      set({ tourComplete: true, tourStep: null });
    }
  },
}));
