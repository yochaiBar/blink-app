import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { connectSocket, disconnectSocket } from '@/services/socket';
import { requestKeyshare } from '@/services/api';
import { playChallengeRing } from '@/utils/challengeSound';
import { getOrCreateDeviceKey, loadGroupKeyVersion } from '@/services/groupCrypto';
import { acceptKeyshareEnvelope, respondToKeyshareRequest } from '@/services/keyTransfer';
import { receivePhoto, respondToPickup } from '@/services/photoTransfer';
import type {
  IncomingPhotoEnvelope,
  KeyRotatedEvent,
  KeyshareEnvelope,
  KeyshareRequest,
  PhotoPickupRequest,
} from '@/shared/photoProtocol';

/** The signed-in user's id, read at event time (listeners outlive renders). */
function currentUserId(): string | undefined {
  return useAuthStore.getState().user?.id;
}

interface ChallengeStartedPayload {
  id: string;
  group_id: string;
  created_by?: string;
}

interface ChallengeResponsePayload {
  challengeId: string;
  groupId?: string;
  response: { id: string; challenge_id: string; user_id: string };
}

interface ChallengeCompletedPayload {
  challengeId: string;
  groupId: string;
}

interface MemberJoinedPayload {
  groupId: string;
  userId: string;
  displayName: string;
}

interface CommentEventPayload {
  response_id: string;
  comment?: unknown;
  comment_id?: string;
}

/**
 * Manages the Socket.io connection lifecycle and wires real-time events
 * to React Query cache invalidation. Group rooms are joined by the server
 * (on connect and on create / join / leave), not by the client.
 *
 * Call this once inside the root layout (inside QueryClientProvider and
 * after auth state is available).
 */
export function useSocket() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const listenersAttached = useRef(false);

  // Connect / disconnect based on auth state
  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      listenersAttached.current = false;
      return;
    }

    const socket = connectSocket();
    if (!socket) return;

    // Attach event listeners only once per socket instance
    if (!listenersAttached.current) {
      listenersAttached.current = true;

      socket.on('challenge:started', (data: ChallengeStartedPayload) => {
        if (__DEV__) console.log('[Socket] challenge:started', data);
        const groupId = data.group_id;
        queryClient.invalidateQueries({ queryKey: ['challenge', groupId] });
        queryClient.invalidateQueries({ queryKey: ['groups'] });

        // Play distinctive alert sound + haptics for group members (skip for originator)
        if (data.created_by !== currentUserId()) {
          playChallengeRing().catch(() => {});
        }
      });

      socket.on('challenge:response', (data: ChallengeResponsePayload) => {
        if (__DEV__) console.log('[Socket] challenge:response', data);
        queryClient.invalidateQueries({ queryKey: ['responses', data.challengeId] });
        queryClient.invalidateQueries({ queryKey: ['groups'] });
        queryClient.invalidateQueries({ queryKey: ['challenge-reveal', data.challengeId] });
        queryClient.invalidateQueries({ queryKey: ['feed-active-challenges'] });
        queryClient.invalidateQueries({ queryKey: ['blinks-feed-v2'] });
        if (data.groupId) {
          queryClient.invalidateQueries({ queryKey: ['challenge', data.groupId] });
        }
      });

      socket.on('challenge:completed', (data: ChallengeCompletedPayload) => {
        if (__DEV__) console.log('[Socket] challenge:completed', data);
        queryClient.invalidateQueries({ queryKey: ['challenge', data.groupId] });
        queryClient.invalidateQueries({ queryKey: ['responses', data.challengeId] });
        queryClient.invalidateQueries({ queryKey: ['groups'] });
      });

      socket.on('group:member-joined', (data: MemberJoinedPayload) => {
        if (__DEV__) console.log('[Socket] group:member-joined', data);
        queryClient.invalidateQueries({ queryKey: ['groups'] });
      });

      socket.on('comment:created', (data: CommentEventPayload) => {
        if (__DEV__) console.log('[Socket] comment:created', data);
        queryClient.invalidateQueries({ queryKey: ['comments', data.response_id] });
      });

      socket.on('comment:deleted', (data: CommentEventPayload) => {
        if (__DEV__) console.log('[Socket] comment:deleted', data);
        queryClient.invalidateQueries({ queryKey: ['comments', data.response_id] });
      });

      // ── E2E photo flow ───────────────────────────────────────
      // The handshake carries our device_id (services/socket.ts), so the
      // server can target pickup_request to the device holding the plaintext.

      // Incoming photo from a group member: decrypt, store, ACK.
      // Server side uses emitWithAck so the third arg is the ACK callback —
      // we call it with {ok: true} or {ok: false, error}.
      socket.on(
        'photo:incoming',
        async (payload: IncomingPhotoEnvelope, ack: (response: { ok: boolean; error?: string }) => void) => {
          if (__DEV__) console.log('[Socket] photo:incoming', payload.response_id);
          try {
            const result = await receivePhoto(payload);
            ack(result);
            if (result.ok) {
              // Invalidate any query that may show this photo so the
              // FeedItem / reveal screen re-reads from the local sandbox.
              queryClient.invalidateQueries({ queryKey: ['responses', payload.challenge_id] });
              queryClient.invalidateQueries({ queryKey: ['blinks-feed-v2'] });
              // FeedItem's local-photo query (Phase 5) — swap from
              // pending skeleton to the freshly-decrypted file URI.
              queryClient.invalidateQueries({ queryKey: ['localPhoto', payload.response_id] });
            }
          } catch (err) {
            if (__DEV__) console.warn('[Socket] photo:incoming handler threw', err);
            ack({ ok: false, error: 'BAD_PAYLOAD' });
          }
        },
      );

      // Server asks us (sender) to re-encrypt for a now-online recipient.
      // Re-encrypt from our local plaintext cache and POST to /relay.
      // If our cache has expired (TTL > 7d), respondToPickup returns null;
      // the server offers the pickup again later and reaps it after 7 days.
      socket.on('photo:pickup_request', async (payload: PhotoPickupRequest) => {
        if (__DEV__) console.log('[Socket] photo:pickup_request', payload);
        const senderUserId = currentUserId();
        if (!senderUserId) return;
        try {
          await respondToPickup(payload, senderUserId);
        } catch (err) {
          if (__DEV__) console.warn('[Socket] pickup respond failed', err);
        }
      });

      // ── Group-key courier handshake (services/keyTransfer) ──
      // Courier path: a holder of the current key is asked to wrap it for a
      // joiner's device. The server routes the opaque envelope; it can't
      // decrypt it.
      socket.on('group:keyshare_request', async (payload: KeyshareRequest) => {
        if (__DEV__) console.log('[Socket] group:keyshare_request', payload.group_id);
        try {
          const delivered = await respondToKeyshareRequest(payload);
          if (!delivered && __DEV__) console.warn('[Socket] keyshare_request: we don’t hold that key version');
        } catch (err) {
          if (__DEV__) console.warn('[Socket] keyshare_request failed', err);
        }
      });

      // Joiner path: the key wrapped for this device. Accepted only at a
      // version not below ours that the server confirms is current.
      socket.on('group:keyshare_envelope', async (envelope: KeyshareEnvelope) => {
        if (__DEV__) console.log('[Socket] group:keyshare_envelope', envelope.group_id);
        const selfUserId = currentUserId();
        if (!selfUserId) return;
        try {
          const outcome = await acceptKeyshareEnvelope(envelope, selfUserId);
          if (__DEV__) console.log('[Socket] keyshare_envelope', outcome);
          if (outcome === 'stored') queryClient.invalidateQueries({ queryKey: ['groups'] });
        } catch (err) {
          if (__DEV__) console.warn('[Socket] keyshare_envelope failed', err);
        }
      });

      // A reset's new key now has a holder (the admin who minted it). If
      // ours is older (or missing), ask for it; a holder couriers it back.
      socket.on('group:key_rotated', async (payload: KeyRotatedEvent) => {
        if (__DEV__) console.log('[Socket] group:key_rotated', payload);
        try {
          const localVersion = await loadGroupKeyVersion(payload.group_id);
          if (payload.group_key_version > localVersion) {
            const { device_id } = await getOrCreateDeviceKey();
            await requestKeyshare({ group_id: payload.group_id, device_id });
          }
        } catch (err) {
          if (__DEV__) console.warn('[Socket] key_rotated handling failed', err);
        }
      });
    }

    return () => {
      // On cleanup (logout, unmount) tear down everything
      disconnectSocket();
      listenersAttached.current = false;
    };
  }, [isAuthenticated]);
}
