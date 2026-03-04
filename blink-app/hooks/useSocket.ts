import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { connectSocket, disconnectSocket, joinGroups, getSocket } from '@/services/socket';
import { api } from '@/services/api';

interface ChallengeStartedPayload {
  id: string;
  group_id: string;
}

interface ChallengeResponsePayload {
  challengeId: string;
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
      });

      socket.on('challenge:response', (data: ChallengeResponsePayload) => {
        if (__DEV__) console.log('[Socket] challenge:response', data);
        queryClient.invalidateQueries({ queryKey: ['responses', data.challengeId] });
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
