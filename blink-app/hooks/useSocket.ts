import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { connectSocket, disconnectSocket } from '@/services/socket';
import { attachSocketEvents } from '@/services/socketEvents';

/**
 * Socket.io connection lifecycle: connected while signed in, closed on
 * logout. Every event listener lives in services/socketEvents.
 *
 * Call this once inside the root layout (inside QueryClientProvider).
 */
export function useSocket() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      return;
    }
    const socket = connectSocket();
    if (socket) attachSocketEvents(socket, queryClient);
    return () => disconnectSocket();
  }, [isAuthenticated, queryClient]);
}
