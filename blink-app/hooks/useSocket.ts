import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { connectSocket, disconnectSocket, joinGroups, getSocket } from '@/services/socket';
import { api } from '@/services/api';
import { playChallengeRing } from '@/utils/challengeSound';
import {
  bytesToB64,
  b64ToBytes,
  courierEncryptGroupKey,
  joinerDecryptGroupKey,
  loadGroupKey,
  storeGroupKey,
  getOrCreateDeviceKey,
} from '@/services/groupCrypto';
import { receivePhoto, respondToPickup } from '@/services/photoTransfer';
import { deliverKeyshare } from '@/services/api';
import type {
  IncomingPhotoEnvelope,
  KeyshareEnvelope,
  KeyshareRequest,
  PhotoPickupRequest,
} from '@/shared/photoProtocol';

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
 * to React Query cache invalidation.
 *
 * Call this once inside the root layout (inside QueryClientProvider and
 * after auth state is available).
 */
export function useSocket() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
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
        if (data.created_by !== user?.id) {
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

      // ── E2E photo flow (Phase 3) ─────────────────────────────
      // Register this socket with our specific device_id so the server can
      // target pickup_request to the device that holds the plaintext.
      getOrCreateDeviceKey()
        .then(({ device_id }) => socket.emit('register-device', device_id))
        .catch(() => undefined);

      // Incoming photo from a group member: decrypt, store, ACK.
      // Server side uses emitWithAck so the third arg is the ACK callback —
      // we call it with {ok: true} or {ok: false, error}.
      socket.on(
        'photo:incoming',
        async (
          payload: IncomingPhotoEnvelope & { ciphertext_b64: string },
          ack: (response: { ok: boolean; error?: string }) => void,
        ) => {
          if (__DEV__) console.log('[Socket] photo:incoming', payload.response_id);
          try {
            const result = await receivePhoto(payload);
            ack(result);
            if (result.ok) {
              // Invalidate any query that may show this photo so the
              // FeedItem / reveal screen re-reads from the local sandbox.
              queryClient.invalidateQueries({ queryKey: ['responses', payload.challenge_id] });
              queryClient.invalidateQueries({ queryKey: ['blinks-feed-v2'] });
            }
          } catch (err) {
            if (__DEV__) console.warn('[Socket] photo:incoming handler threw', err);
            ack({ ok: false, error: 'BAD_PAYLOAD' });
          }
        },
      );

      // Server asks us (sender) to re-encrypt for a now-online recipient.
      // Re-encrypt from our local plaintext cache and POST to /relay.
      // If our cache has expired (TTL > 7d), respondToPickup returns null
      // and the server's TTL job will eventually expire the pending row.
      socket.on(
        'photo:pickup_request',
        async (payload: PhotoPickupRequest) => {
          if (__DEV__) console.log('[Socket] photo:pickup_request', payload);
          try {
            await respondToPickup({
              ...payload,
              challengeId: payload.challenge_id,
            });
          } catch (err) {
            if (__DEV__) console.warn('[Socket] pickup respond failed', err);
          }
        },
      );

      // ── Group-key courier handshake (Phase 4) ───────────────
      // Courier path: server asks us to share the group key with a joiner.
      // Look up our local group key, encrypt to the joiner's public key,
      // POST the opaque envelope to /api/keyshare/deliver. Server can't
      // decrypt — it just routes to the joiner's device room.
      socket.on('group:keyshare_request', async (payload: KeyshareRequest) => {
        if (__DEV__) console.log('[Socket] group:keyshare_request', payload);
        try {
          const groupKey = await loadGroupKey(payload.group_id);
          if (!groupKey) {
            // We're a member but somehow have no group key — race with our
            // own join? Best-effort: ignore. Another courier (or our own
            // device on next launch) will pick this up.
            if (__DEV__) {
              console.warn('[Socket] keyshare_request but no local group key');
            }
            return;
          }
          const joinerPub = b64ToBytes(payload.joiner_x25519_public_key_b64);
          const envelope = courierEncryptGroupKey(joinerPub, groupKey);
          const { device_id: fromDeviceId } = await getOrCreateDeviceKey();
          await deliverKeyshare({
            v: 1,
            pending_join_id: payload.pending_join_id,
            group_id: payload.group_id,
            from_user_id: user?.id ?? '',
            from_device_id: fromDeviceId,
            ephemeral_public_key_b64: bytesToB64(envelope.ephemeralPublicKey),
            iv_b64: bytesToB64(envelope.iv),
            auth_tag_b64: bytesToB64(
              envelope.ciphertext.slice(envelope.ciphertext.length - 16),
            ),
            ciphertext_b64: bytesToB64(envelope.ciphertext),
            group_key_version: 1,
          });
        } catch (err) {
          if (__DEV__) console.warn('[Socket] keyshare_request failed', err);
        }
      });

      // Joiner path: server delivered the encrypted group-key envelope.
      // ECDH + decrypt with our static device key, store the group key
      // locally. Idempotent: if we already have the key, validate the new
      // one matches; otherwise newest wins per the key_version field on
      // the envelope (Phase 5+ will surface UX when these differ).
      socket.on(
        'group:keyshare_envelope',
        async (envelope: KeyshareEnvelope) => {
          if (__DEV__) console.log('[Socket] group:keyshare_envelope', envelope.group_id);
          try {
            const device = await getOrCreateDeviceKey();
            const ephemeral = b64ToBytes(envelope.ephemeral_public_key_b64);
            const iv = b64ToBytes(envelope.iv_b64);
            const ciphertext = b64ToBytes(envelope.ciphertext_b64);
            const groupKey = joinerDecryptGroupKey(
              device.privateScalar,
              device.publicKey,
              { ephemeralPublicKey: ephemeral, iv, ciphertext },
            );
            const existing = await loadGroupKey(envelope.group_id);
            if (existing) {
              // Reinstall race / duplicate envelope: accept only if it's
              // the SAME key (idempotent). If different, refuse to overwrite
              // — would silently brick all our existing decrypted photos.
              const same =
                existing.length === groupKey.length &&
                existing.every((b, i) => b === groupKey[i]);
              if (!same) {
                if (__DEV__) {
                  console.warn(
                    '[Socket] keyshare_envelope conflicts with existing key; ignored',
                  );
                }
                return;
              }
            }
            await storeGroupKey(envelope.group_id, groupKey);
            queryClient.invalidateQueries({ queryKey: ['groups'] });
          } catch (err) {
            if (__DEV__) console.warn('[Socket] keyshare_envelope decrypt failed', err);
          }
        },
      );

      // Loser of the courier race — server picked someone else. No-op.
      socket.on('group:keyshare_cancelled', () => {
        if (__DEV__) console.log('[Socket] group:keyshare_cancelled (no-op)');
      });
    }

    // Fetch user's groups and join the corresponding rooms
    fetchAndJoinGroups();

    return () => {
      // On cleanup (logout, unmount) tear down everything
      disconnectSocket();
      listenersAttached.current = false;
    };
  }, [isAuthenticated]);

  // Re-join group rooms when the user changes (e.g., after token refresh)
  // or when groups data is refreshed
  useEffect(() => {
    if (isAuthenticated) {
      fetchAndJoinGroups();
    }
  }, [isAuthenticated, user?.id]);

  /**
   * Fetch the user's groups from the API and tell the socket to join
   * those room channels.
   */
  async function fetchAndJoinGroups() {
    try {
      const groups: Array<{ id: string }> = await api('/groups');
      if (Array.isArray(groups) && groups.length > 0) {
        const groupIds = groups.map((g) => g.id);
        joinGroups(groupIds);
      }
    } catch {
      // Groups may not load on first attempt -- the React Query refetch
      // will trigger another join via the onConnect callback.
      if (__DEV__) console.warn('[Socket] Failed to fetch groups for room join');
    }
  }

  // Also join rooms when the socket reconnects (e.g., after network drop)
  useEffect(() => {
    if (!isAuthenticated) return;

    const socket = getSocket();
    if (!socket) return;

    const onReconnect = () => {
      if (__DEV__) console.log('[Socket] Reconnected, re-joining groups');
      fetchAndJoinGroups();
    };

    socket.on('connect', onReconnect);
    return () => {
      socket.off('connect', onReconnect);
    };
  }, [isAuthenticated]);
}
