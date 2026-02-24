import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Zap } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import ActivityRow from '@/components/ActivityRow';
import { ActivityItem } from '@/types';
import { Skeleton, EmptyState } from '@/components/ui';

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const { activity, refreshGroups, isLoading } = useApp();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const renderItem = useCallback(({ item }: { item: ActivityItem }) => (
    <ActivityRow item={item} />
  ), []);

  const keyExtractor = useCallback((item: ActivityItem) => item.id, []);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshGroups();
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshGroups]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Zap size={22} color={theme.coral} fill={theme.coral} />
        <Text style={styles.title}>Activity</Text>
      </View>

      {isLoading ? (
        <View style={styles.list}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.skeletonRow}>
              <Skeleton variant="circle" width={40} height={40} />
              <View style={styles.skeletonLines}>
                <Skeleton variant="text" width={180} height={14} />
                <Skeleton variant="text" width={120} height={12} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={activity}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
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
  list: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  skeletonLines: {
    flex: 1,
    gap: 6,
  },
});
