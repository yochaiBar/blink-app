import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { NotificationItem } from '@/types';
import type {
  GroupDeviceKeysResponse,
  KeyshareConfirmResult,
  KeyshareDeliverRequest,
  KeyshareDeliverResult,
  KeyshareRecoveryResult,
  KeyshareResetResult,
  RelayPhotoRequest,
  RelayPhotoResult,
} from '@/shared/photoProtocol';

// ── Response types for API functions ──

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
  blocked_at: string;
}

interface PushTokenResponse {
  success: boolean;
}

// API_URL resolution:
// 1. extra.apiUrl — EXPO_PUBLIC_API_URL from the EAS build profile, via
//    app.config.ts (which refuses a release build without it).
// 2. Dev only: the dev machine — localhost on web, otherwise the host Metro
//    is served from (`hostUri`), port 3000. Dev never talks to production.
function resolveApiUrl(): string {
  const configured = Constants.expoConfig?.extra?.apiUrl as string | undefined;
  if (configured) return configured;
  if (!__DEV__) throw new Error('No API URL configured for this build (EXPO_PUBLIC_API_URL)');
  if (Platform.OS === 'web') return 'http://localhost:3000/api';
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${devHost || 'localhost'}:3000/api`;
}

export const API_URL = resolveApiUrl();

/** A non-2xx API response; `status` lets callers branch on e.g. 409. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

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

/** Is a session stored on this device (a refresh token we haven't been told is dead)? */
export async function hasStoredSession(): Promise<boolean> {
  return !!(await storage.get('refreshToken'));
}

export async function clearTokens() {
  accessToken = null;
  await storage.remove('accessToken');
  await storage.remove('refreshToken');
}

// Called once when the server rejects our refresh token (the session is
// over: revoked, expired or reused). authStore registers its logout here;
// a callback keeps api.ts free of a circular import.
let sessionExpiredHandler: (() => void) | null = null;

export function onSessionExpired(handler: () => void): void {
  sessionExpiredHandler = handler;
}

let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const refreshToken = await storage.get('refreshToken');
  if (!refreshToken) return false;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return false; // offline: keep the session and try again later
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      // Clear first, so the logout this triggers doesn't 401 its way back here.
      await clearTokens();
      sessionExpiredHandler?.();
    }
    return false;
  }
  // The server rotates the refresh token on every refresh; keep both.
  const data = (await res.json()) as { access_token: string; refresh_token: string };
  await setTokens(data.access_token, data.refresh_token);
  return true;
}

/**
 * Exchange the refresh token for a new pair. Single-flight: concurrent
 * callers (parallel 401s, a socket reconnect) share one request, since the
 * server rotates the refresh token and a second use would end the session.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const sentToken = accessToken;
  if (sentToken) {
    headers['Authorization'] = `Bearer ${sentToken}`;
  }

  let res = await fetch(`${API_URL}${path}`, { ...options, headers });

  // Auto-refresh on 401 — unless another request already did, in which
  // case just retry with the newer token.
  if (res.status === 401 && sentToken) {
    const refreshed = accessToken !== sentToken || (await refreshSession());
    if (refreshed && accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${API_URL}${path}`, { ...options, headers });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || `Request failed: ${res.status}`, res.status);
  }

  // Handle 204 No Content and empty responses
  if (res.status === 204) return null as T;
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

// Photos never go through the API: the E2E flow uses relayPhoto() below +
// photoTransfer. There are no avatars; members show initials (AvatarRing).

// ── User Stats ──
export async function getUserStats(): Promise<UserStatsResponse> {
  return api<UserStatsResponse>('/auth/stats');
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

// ── Group-key courier handshake (protocol v2) ──

/** Fellow members' active device keys (members only), for TOFU pinning. */
export function getGroupDeviceKeys(groupId: string): Promise<GroupDeviceKeysResponse> {
  return api<GroupDeviceKeysResponse>(`/device-keys?group_id=${encodeURIComponent(groupId)}`);
}

/** Courier: hand the encrypted key to the server for the joiner's device. */
export function deliverKeyshare(body: KeyshareDeliverRequest): Promise<KeyshareDeliverResult> {
  return api<KeyshareDeliverResult>('/keyshare/deliver', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Ask a holder of the current key to courier it to this device. Used when
 * a member has no local key (stalled join, reinstall) or a stale one after
 * a reset.
 */
export function requestKeyshare(body: { group_id: string; device_id: string }): Promise<KeyshareRecoveryResult> {
  return api<KeyshareRecoveryResult>('/keyshare/request', {
    method: 'POST',
    body: JSON.stringify({ v: 2, ...body }),
  });
}

/**
 * Tell the server this device holds the group key at `key_version`. Rejects
 * (409) unless it's the group's current version. Makes us a courier.
 */
export function confirmGroupKey(body: { group_id: string; key_version: number }): Promise<KeyshareConfirmResult> {
  return api<KeyshareConfirmResult>('/keyshare/confirm', {
    method: 'POST',
    body: JSON.stringify({ v: 2, ...body }),
  });
}

/**
 * Admin-only, step one of a reset: bump the group's key version on the
 * server (which never sees the key). The caller then mints a fresh key at
 * the returned version and confirms it; only then are members told.
 */
export function resetGroupKey(body: { group_id: string }): Promise<KeyshareResetResult> {
  return api<KeyshareResetResult>('/keyshare/reset', {
    method: 'POST',
    body: JSON.stringify({ v: 2, ...body }),
  });
}

// ── Photo relay (E2E photo flow, protocol v2) ──
export function relayPhoto(body: RelayPhotoRequest): Promise<RelayPhotoResult> {
  return api<RelayPhotoResult>('/photos/relay', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Device public key (E2E photo flow, Phase 2) ──
export interface RegisterDeviceKeyBody {
  v: 1;
  device_id: string;
  x25519_public_key_b64: string;
  attestation_b64: string;
}

export interface RegisterDeviceKeyResult {
  v: 1;
  device_id: string;
  key_version: number;
  registered_at: string;
}

export function registerDeviceKey(body: RegisterDeviceKeyBody): Promise<RegisterDeviceKeyResult> {
  return api<RegisterDeviceKeyResult>('/device-keys', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Comments ──
export interface CommentItem {
  id: string;
  response_id: string;
  user_id: string;
  parent_comment_id: string | null;
  text: string;
  created_at: string;
  updated_at: string;
  display_name: string | null;
}

export function fetchComments(responseId: string): Promise<CommentItem[]> {
  return api<CommentItem[]>(`/challenges/responses/${responseId}/comments`);
}

export function postComment(responseId: string, text: string, parentCommentId?: string): Promise<CommentItem> {
  return api<CommentItem>(`/challenges/responses/${responseId}/comments`, {
    method: 'POST',
    body: JSON.stringify(parentCommentId ? { text, parent_comment_id: parentCommentId } : { text }),
  });
}

export function deleteComment(commentId: string): Promise<void> {
  return api<void>(`/challenges/comments/${commentId}`, { method: 'DELETE' });
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
