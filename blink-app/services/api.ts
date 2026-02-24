import { Platform } from 'react-native';

const API_URL = __DEV__ ? 'http://localhost:3000/api' : 'https://api.blink.app/api';

let accessToken: string | null = null;

// SecureStore doesn't work on web — fall back to localStorage
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

export async function loadToken() {
  accessToken = await storage.get('accessToken');
}

export async function setTokens(access: string, refresh: string) {
  accessToken = access;
  await storage.set('accessToken', access);
  await storage.set('refreshToken', refresh);
}

export async function clearTokens() {
  accessToken = null;
  await storage.remove('accessToken');
  await storage.remove('refreshToken');
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = await storage.get('refreshToken');
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.accessToken;
    await storage.set('accessToken', data.accessToken);
    return true;
  } catch {
    return false;
  }
}

export async function api(path: string, options: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let res = await fetch(`${API_URL}${path}`, { ...options, headers });

  // Auto-refresh on 401
  if (res.status === 401 && accessToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${API_URL}${path}`, { ...options, headers });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  // Handle 204 No Content and empty responses
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}
