/**
 * Test Setup - blink-app
 *
 * Configures the test environment by mocking:
 * - React Native modules (Platform, etc.)
 * - Expo modules (SecureStore, Haptics, etc.)
 * - Navigation and routing
 * - fetch API for network calls
 */

// ── Mock React Native ─────────────────────────────────────────────
jest.mock('react-native', () => ({
  Platform: {
    OS: 'web',
    select: jest.fn((obj: any) => obj.web || obj.default),
  },
  StyleSheet: {
    create: (styles: any) => styles,
  },
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Animated: {
    View: 'Animated.View',
    Value: jest.fn().mockImplementation(() => ({
      interpolate: jest.fn(),
    })),
    spring: jest.fn().mockReturnValue({ start: jest.fn() }),
    timing: jest.fn().mockReturnValue({ start: jest.fn() }),
  },
  Modal: 'Modal',
}));

// ── Mock expo-secure-store ────────────────────────────────────────
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// ── Mock expo-haptics ─────────────────────────────────────────────
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
  },
}));

// ── Mock expo-notifications ───────────────────────────────────────
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'undetermined' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[mock]' }),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
}));

// ── Mock expo-constants ───────────────────────────────────────────
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

// ── Mock expo-image ───────────────────────────────────────────────
jest.mock('expo-image', () => ({
  Image: 'Image',
}));

// ── Mock lucide-react-native ──────────────────────────────────────
jest.mock('lucide-react-native', () => ({
  Lock: 'Lock',
  MoreHorizontal: 'MoreHorizontal',
  ChevronRight: 'ChevronRight',
  Clock: 'Clock',
}));

// ── Mock __DEV__ ──────────────────────────────────────────────────
(global as any).__DEV__ = true;

// ── Setup localStorage for web fallback ───────────────────────────
const localStorageStore: Record<string, string> = {};
(global as any).localStorage = {
  getItem: jest.fn((key: string) => localStorageStore[key] ?? null),
  setItem: jest.fn((key: string, value: string) => { localStorageStore[key] = value; }),
  removeItem: jest.fn((key: string) => { delete localStorageStore[key]; }),
  clear: jest.fn(() => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); }),
};

// ── Setup fetch mock ──────────────────────────────────────────────
(global as any).fetch = jest.fn();

// ── Cleanup ───────────────────────────────────────────────────────
afterEach(() => {
  jest.clearAllMocks();
  (global as any).localStorage.clear();
});

afterAll(() => {
  jest.restoreAllMocks();
});
