import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getNotifications, markNotificationsRead as markNotificationsReadApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { queryKeys } from '@/utils/queryKeys';

export function useNotifications() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications.all,
    queryFn: getNotifications,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const notifications = notificationsQuery.data ?? [];

  const unreadNotificationCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  const markNotificationsRead = useCallback(async () => {
    try {
      await markNotificationsReadApi();
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    } catch {
      // Silently fail -- UI already marked as read locally
    }
  }, [queryClient]);

  return {
    notifications,
    unreadNotificationCount,
    markNotificationsRead,
    isNotificationsLoading: notificationsQuery.isLoading,
    isNotificationsError: notificationsQuery.isError,
    refetchNotifications: notificationsQuery.refetch,
  };
}
