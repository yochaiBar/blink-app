import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { ActivityItem, NotificationItem } from '@/types';
import type { ApiSpotlight } from '@/types/api';

// ── Response types for API functions ──

interface PresignResponse {
  uploadUrl?: string;
  publicUrl: string;
}

interface UserStatsResponse {
  total_snaps: number;
  longest_streak: number;
  group_count: number;
}

interface ReactionResponse {
  id: string;
  emoji: string;
  user_id: string;
}

interface ReportResponse {
  id: string;
  status: string;
}

interface BlockResponse {
  id: string;
  blocked_id: string;
}

interface BlockedUserItem {
  blocked_id: string;
  display_name: string | null;
  avatar_url: string | null;
  blocked_at: string;
}

interface PushTokenResponse {
  success: boolean;
}

// API_URL resolution order:
// 1. expo-constants extra.apiUrl (set via app.config.ts from EAS env vars)
// 2. Dev fallback: localhost (web) or LAN IP (native)
// 3. Production fallback: production API domain
const configApiUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;

function resolveApiUrl(): string {
  if (configApiUrl) return configApiUrl;
  if (__DEV__) {
    return Platform.OS === 'web' ? 'http://localhost:3000/api' : 'https://blink-api-production.up.railway.app/api'; // was 192.168.68.120:3000
  }
  return 'https://blink-api-production.up.railway.app/api';
}

export const API_URL = resolveApiUrl();

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

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

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
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
  if (res.status === 204) return null as T;
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

// ── Upload ──
export async function uploadPhoto(imageUri: string, groupId: string, challengeId: string): Promise<string> {
  const presign = await api<PresignResponse>('/upload/presign', {
    method: 'POST',
    body: JSON.stringify({ groupId, challengeId }),
  });

  // Dev mode (no S3) — return as-is
  if (!presign.uploadUrl) return imageUri;

  let blob: Blob;

  if (imageUri.startsWith('data:')) {
    // Base64 data URI — decode to blob
    const base64Data = imageUri.replace(/^data:image\/\w+;base64,/, '');
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: 'image/jpeg' });
  } else {
    // File URI (file://) — fetch as blob (works in React Native)
    const fileRes = await fetch(imageUri);
    blob = await fileRes.blob();
  }

  // Upload directly to S3 via presigned PUT URL
  const uploadRes = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });

  if (!uploadRes.ok) {
    throw new Error(`S3 upload failed: ${uploadRes.status}`);
  }

  return presign.publicUrl;
}

// ── User Stats ──
export async function getUserStats(): Promise<UserStatsResponse> {
  return api<UserStatsResponse>('/auth/stats');
}

// ── Activity ──
export async function getActivity(): Promise<ActivityItem[]> {
  const data = await api<ActivityItem[]>('/activity');
  if (!Array.isArray(data)) return [];
  // Map any server-only types to UI types.
  // 'challenge_triggered' is kept as-is since the ActivityItem type now includes it.
  const typeMap: Record<string, ActivityItem['type']> = {
    challenge_triggered: 'challenge_triggered',
  };
  return data.map((item: ActivityItem) => ({
    ...item,
    type: typeMap[item.type] || item.type,
    timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
  }));
}

// ── Notifications ──
export async function getNotifications(): Promise<NotificationItem[]> {
  const data = await api<NotificationItem[]>('/notifications');
  if (!Array.isArray(data)) return [];
  return data.map((item: NotificationItem) => ({
    ...item,
    timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
  }));
}

export function markNotificationsRead(): Promise<void> {
  return api<void>('/notifications/read', { method: 'PATCH' });
}

// ── Reactions ──
export function addReactionApi(responseId: string, emoji: string): Promise<ReactionResponse> {
  return api<ReactionResponse>(`/challenges/responses/${responseId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
}

export function removeReactionApi(responseId: string, emoji: string): Promise<void> {
  return api<void>(`/challenges/responses/${responseId}/reactions/${encodeURIComponent(emoji)}`, {
    method: 'DELETE',
  });
}

// ── Spotlight ──
export async function getSpotlight(groupId: string): Promise<ApiSpotlight | null> {
  return api<ApiSpotlight | null>(`/spotlight/${groupId}`);
}

// ── Moderation ──
export function reportContent(data: {
  reported_user_id?: string;
  reported_content_id?: string;
  content_type: 'photo' | 'user' | 'group' | 'challenge_response';
  reason: string;
  description?: string;
}): Promise<ReportResponse> {
  return api<ReportResponse>('/moderation/report', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function blockUser(blockedId: string): Promise<BlockResponse> {
  return api<BlockResponse>('/moderation/block', {
    method: 'POST',
    body: JSON.stringify({ blocked_id: blockedId }),
  });
}

export function unblockUser(userId: string): Promise<void> {
  return api<void>(`/moderation/blocks/${userId}`, { method: 'DELETE' });
}

export function getBlockedUsers(): Promise<BlockedUserItem[]> {
  return api<BlockedUserItem[]>('/moderation/blocks');
}

// ── Push Token Registration ──
export function registerPushToken(pushToken: string): Promise<PushTokenResponse> {
  return api<PushTokenResponse>('/auth/push-token', {
    method: 'POST',
    body: JSON.stringify({ push_token: pushToken }),
  });
}
