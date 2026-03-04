import React, { useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Zap } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import ActivityRow from '@/components/ActivityRow';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { ActivityItem } from '@/types';

function ActivitySkeleton() {
  return (
    <View style={styles.skeletonRow}>
      <Skeleton variant="circle" width={44} height={44} />
      <View style={styles.skeletonContent}>
        <Skeleton variant="text" width={180} height={14} />
        <Skeleton variant="text" width={120} height={12} />
      </View>
      <Skeleton variant="rect" width={46} height={46} borderRadius={10} />
    </View>
  );
}

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    activity,
    isActivityLoading,
    isActivityError,
    refetchActivity,
    refreshGroups,
  } = useApp();

  const renderItem = useCallback(({ item }: { item: ActivityItem }) => (
    <ActivityRow
      item={item}
      onPress={() => router.push({ pathname: '/group-detail' as never, params: { id: item.groupId } })}
    />
  ), [router]);

  const keyExtractor = useCallback((item: ActivityItem) => item.id, []);

  const onRefresh = useCallback(async () => {
    await Promise.all([refetchActivity(), refreshGroups()]);
  }, [refetchActivity, refreshGroups]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Zap size={22} color={theme.coral} fill={theme.coral} />
        <Text style={styles.title}>Activity</Text>
      </View>

      {/* Loading state */}
      {isActivityLoading && (
        <View style={styles.loadingContainer}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <ActivitySkeleton key={i} />
          ))}
        </View>
      )}

      {/* Error state */}
      {isActivityError && !isActivityLoading && (
        <ErrorState
          message="Could not load activity"
          onRetry={() => refetchActivity()}
        />
      )}

      {/* Data */}
      {!isActivityLoading && !isActivityError && (
        <FlatList
          data={activity}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={onRefresh}
              tintColor={theme.coral}
            />
          }
          ListEmptyComponent={
            <EmptyState
              emoji="📭"
              title="No activity yet"
              subtitle="Join a group and start snapping to see activity here!"
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: theme.text,
    letterSpacing: -0.5,
  },
  loadingContainer: {
    paddingHorizontal: 20,
    gap: 4,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
  },
  skeletonContent: {
    flex: 1,
    gap: 8,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
});
