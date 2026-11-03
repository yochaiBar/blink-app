/**
 * Every Socket.io listener the app has, attached once per socket by
 * attachSocketEvents (from useSocket). Events invalidate React Query caches
 * and drive the E2E photo and key flows; screens that want to react to a
 * moment (a finalized challenge, a new response) subscribe() here instead of
 * touching the socket. Group rooms are joined by the server, not the client.
 */

import type { QueryClient } from '@tanstack/react-query';
import { requestKeyshare } from '@/services/api';
import { getOrCreateDeviceKey, loadGroupKeyVersion } from '@/services/groupCrypto';
import { acceptKeyshareEnvelope, respondToKeyshareRequest } from '@/services/keyTransfer';
import { receivePhoto, respondToPickup } from '@/services/photoTransfer';
import { retryPendingRelays } from '@/services/relayRetry';
import { useAuthStore } from '@/stores/authStore';
import { playChallengeRing } from '@/utils/challengeSound';
import type {
  IncomingPhotoEnvelope,
  KeyRotatedEvent,
  KeyshareEnvelope,
  KeyshareRequest,
  PhotoPickupRequest,
} from '@/shared/photoProtocol';

// ── Payloads (server: services/challengeLifecycle.ts, routes) ─────

interface ChallengeStartedEvent {
  id: string;
  group_id: string;
  created_by?: string | null;
}

export interface ChallengeResponseEvent {
  challengeId: string;
  groupId: string;
  response: { id: string; challenge_id: string; user_id: string };
}

export interface ChallengeFinalizedEvent {
  challengeId: string;
  groupId: string;
  status: 'completed' | 'expired';
  groupStreak: number;
  brokenBy: string | null;
  milestones: { userId: string; displayName: string; streak: number }[];
}

interface MemberJoinedEvent {
  groupId: string;
}

interface CommentEvent {
  response_id: string;
}

// ── Subscriptions for screens ─────────────────────────────────────

interface AppEvents {
  'challenge:response': ChallengeResponseEvent;
  'challenge:finalized': ChallengeFinalizedEvent;
}

const subscribers: { [K in keyof AppEvents]: Set<(payload: AppEvents[K]) => void> } = {
  'challenge:response': new Set(),
  'challenge:finalized': new Set(),
};

/** Run `listener` on every `event`; returns the unsubscribe function. */
export function subscribe<K extends keyof AppEvents>(event: K, listener: (payload: AppEvents[K]) => void): () => void {
  subscribers[event].add(listener);
  return () => {
    subscribers[event].delete(listener);
  };
}

function publish<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
  for (const listener of subscribers[event]) {
    try {
      listener(payload);
    } catch (err) {
      if (__DEV__) console.warn(`[Socket] ${event} subscriber threw`, err);
    }
  }
}

// ── Registration ──────────────────────────────────────────────────

/** The part of a Socket.io client socket these listeners use. */
export interface SocketLike {
  on(event: string, listener: (...args: never[]) => void): unknown;
}

/** The signed-in user's id, read at event time (listeners outlive renders). */
function currentUserId(): string | undefined {
  return useAuthStore.getState().user?.id;
}

const attached = new WeakSet<SocketLike>();

/** Attach every listener to `socket`. Idempotent per socket instance. */
export function attachSocketEvents(socket: SocketLike, queryClient: QueryClient): void {
  if (attached.has(socket)) return;
  attached.add(socket);
  const invalidate = (...queryKey: unknown[]) => queryClient.invalidateQueries({ queryKey });

  // Back online: photos that couldn't be relayed earlier go out now.
  socket.on('connect', () => {
    retryPendingRelays().catch(() => undefined);
  });

  // ── Challenges ───────────────────────────────────────────────
  socket.on('challenge:started', (data: ChallengeStartedEvent) => {
    invalidate('challenge', data.group_id);
    invalidate('groups');
    invalidate('feed-active-challenges');
    invalidate('blinks-feed-v2');
    // Ring for everyone but the member who started it.
    if (data.created_by !== currentUserId()) playChallengeRing().catch(() => undefined);
  });

  socket.on('challenge:response', (data: ChallengeResponseEvent) => {
    invalidate('responses', data.challengeId);
    invalidate('challenge-reveal', data.challengeId);
    invalidate('challenge', data.groupId);
    invalidate('groups');
    invalidate('feed-active-challenges');
    invalidate('blinks-feed-v2');
    publish('challenge:response', data);
  });

  socket.on('challenge:finalized', (data: ChallengeFinalizedEvent) => {
    invalidate('challenge', data.groupId);
    invalidate('responses', data.challengeId);
    invalidate('groups');
    invalidate('feed-active-challenges');
    invalidate('blinks-feed-v2');
    publish('challenge:finalized', data);
  });

  socket.on('group:member-joined', (_data: MemberJoinedEvent) => {
    invalidate('groups');
  });

  socket.on('comment:created', (data: CommentEvent) => {
    invalidate('comments', data.response_id);
  });

  socket.on('comment:deleted', (data: CommentEvent) => {
    invalidate('comments', data.response_id);
  });

  // ── E2E photos ───────────────────────────────────────────────
  // Incoming photo: decrypt, store, ACK (the server uses emitWithAck; a
  // NACK keeps the recipient's pickup queued).
  socket.on(
    'photo:incoming',
    async (payload: IncomingPhotoEnvelope, ack: (response: { ok: boolean; error?: string }) => void) => {
      try {
        const result = await receivePhoto(payload);
        ack(result);
        if (result.ok) {
          invalidate('responses', payload.challenge_id);
          invalidate('blinks-feed-v2');
          invalidate('localPhoto', payload.response_id);
        }
      } catch (err) {
        if (__DEV__) console.warn('[Socket] photo:incoming handler threw', err);
        ack({ ok: false, error: 'BAD_PAYLOAD' });
      }
    },
  );

  // We (the sender's device) are asked to re-send to a now-online recipient.
  socket.on('photo:pickup_request', async (payload: PhotoPickupRequest) => {
    const senderUserId = currentUserId();
    if (!senderUserId) return;
    try {
      await respondToPickup(payload, senderUserId);
    } catch (err) {
      if (__DEV__) console.warn('[Socket] pickup respond failed', err);
    }
  });

  // ── Group-key courier handshake (services/keyTransfer) ───────
  socket.on('group:keyshare_request', async (payload: KeyshareRequest) => {
    try {
      const outcome = await respondToKeyshareRequest(payload);
      // Surface "<name>'s security key changed" in group detail.
      if (outcome === 'key_changed') invalidate('deviceKeys', payload.group_id);
    } catch (err) {
      if (__DEV__) console.warn('[Socket] keyshare_request failed', err);
    }
  });

  socket.on('group:keyshare_envelope', async (envelope: KeyshareEnvelope) => {
    const selfUserId = currentUserId();
    if (!selfUserId) return;
    try {
      const outcome = await acceptKeyshareEnvelope(envelope, selfUserId);
      if (outcome === 'stored') {
        invalidate('groups');
        // Snaps that waited for this key can go out now.
        retryPendingRelays().catch(() => undefined);
      }
    } catch (err) {
      if (__DEV__) console.warn('[Socket] keyshare_envelope failed', err);
    }
  });

  // A reset's new key now has a holder. If ours is older (or missing), ask
  // for it; a holder couriers it back.
  socket.on('group:key_rotated', async (payload: KeyRotatedEvent) => {
    try {
      if (payload.group_key_version > (await loadGroupKeyVersion(payload.group_id))) {
        const { device_id } = await getOrCreateDeviceKey();
        await requestKeyshare({ group_id: payload.group_id, device_id });
      }
    } catch (err) {
      if (__DEV__) console.warn('[Socket] key_rotated handling failed', err);
    }
  });
}
