import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityItem } from '@/types';
import { getActivity } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { queryKeys } from '@/utils/queryKeys';

export function useActivity() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const activityQuery = useQuery({
    queryKey: queryKeys.activity.all,
    queryFn: getActivity,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const [localActivity, setLocalActivity] = useState<ActivityItem[]>([]);

  // Merge backend activity with local optimistic items
  const activity = useMemo(() => {
    const backendItems = activityQuery.data ?? [];
    const backendIds = new Set(backendItems.map((i) => i.id));
    const uniqueLocal = localActivity.filter((i) => !backendIds.has(i.id));
    return [...uniqueLocal, ...backendItems];
  }, [activityQuery.data, localActivity]);

  const addActivityItem = useCallback(
    (
      type: ActivityItem['type'],
      groupName: string,
      groupId: string,
      message: string,
      imageUrl?: string,
      userInfo?: { id: string; name: string; avatar: string },
    ) => {
      const item: ActivityItem = {
        id: `activity_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type,
        userId: userInfo?.id ?? 'self',
        userName: userInfo?.name?.split(' ')[0] ?? 'You',
        userAvatar: userInfo?.avatar ?? '',
        groupName,
        groupId,
        message,
        timestamp: new Date().toISOString(),
        imageUrl,
      };
      setLocalActivity((prev) => [item, ...prev]);
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.all });
    },
    [queryClient],
  );

  return {
    activity,
    addActivityItem,
    isActivityLoading: activityQuery.isLoading,
    isActivityError: activityQuery.isError,
    refetchActivity: activityQuery.refetch,
  };
}
