import { create } from 'zustand';
import { Platform } from 'react-native';

type TourStep = 'home' | 'group_detail' | null;

interface OnboardingState {
  tourComplete: boolean;
  tourStep: TourStep;
  demoChallengeCompleted: boolean;
  /** The user hid the demo group (demoSource.isVisible). */
  demoDismissed: boolean;
  demoPhotoUri: string | null;
  startTour: () => void;
  advanceTour: (step: TourStep) => void;
  completeTour: () => void;
  setDemoPhotoUri: (uri: string) => void;
  completeDemoChallenge: () => void;
  dismissDemo: () => void;
  reset: () => Promise<void>;
  hydrate: () => Promise<void>;
}

/** Default tooltip messages for each tour step. */
export const tourMessages: Record<Exclude<TourStep, null>, string> = {
  home: 'Meet your demo crew! Tap to see their latest snaps',
  group_detail: 'This is a challenge! Everyone snaps their view right now',
};

const STORAGE_KEY = 'onboarding_tour_complete';
const DEMO_CHALLENGE_KEY = 'onboarding_demo_challenge_complete';
const DEMO_DISMISSED_KEY = 'onboarding_demo_dismissed';

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
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(key);
  },
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  tourComplete: false,
  tourStep: null,
  demoChallengeCompleted: false,
  demoDismissed: false,
  demoPhotoUri: null,

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

  setDemoPhotoUri: (uri: string) => {
    set({ demoPhotoUri: uri });
  },

  completeDemoChallenge: () => {
    set({ demoChallengeCompleted: true });
    storage.set(DEMO_CHALLENGE_KEY, 'true');
  },

  dismissDemo: () => {
    set({ demoDismissed: true });
    storage.set(DEMO_DISMISSED_KEY, 'true');
  },

  reset: async () => {
    await Promise.all([
      storage.remove(STORAGE_KEY),
      storage.remove(DEMO_CHALLENGE_KEY),
      storage.remove(DEMO_DISMISSED_KEY),
    ]);
    set({
      tourComplete: false,
      tourStep: null,
      demoChallengeCompleted: false,
      demoDismissed: false,
      demoPhotoUri: null,
    });
  },

  hydrate: async () => {
    const [tourValue, demoValue, dismissedValue] = await Promise.all([
      storage.get(STORAGE_KEY),
      storage.get(DEMO_CHALLENGE_KEY),
      storage.get(DEMO_DISMISSED_KEY),
    ]);
    const updates: Partial<OnboardingState> = {};
    if (tourValue === 'true') {
      updates.tourComplete = true;
      updates.tourStep = null;
    }
    if (demoValue === 'true') {
      updates.demoChallengeCompleted = true;
    }
    if (dismissedValue === 'true') {
      updates.demoDismissed = true;
    }
    if (Object.keys(updates).length > 0) {
      set(updates as OnboardingState);
    }
  },
}));
