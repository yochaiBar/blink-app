import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Zap } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import ActivityRow from '@/components/ActivityRow';
import { ActivityItem } from '@/types';

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const { activity } = useApp();

  const renderItem = React.useCallback(({ item }: { item: ActivityItem }) => (
    <ActivityRow item={item} />
  ), []);

  const keyExtractor = React.useCallback((item: ActivityItem) => item.id, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Zap size={22} color={theme.coral} fill={theme.coral} />
        <Text style={styles.title}>Activity</Text>
      </View>

      <FlatList
        data={activity}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🦗</Text>
            <Text style={styles.emptyText}>No activity yet</Text>
            <Text style={styles.emptySubtext}>Join a group to see what your friends are up to!</Text>
          </View>
        }
      />
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
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 8,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: theme.text,
  },
  emptySubtext: {
    fontSize: 14,
    color: theme.textMuted,
    textAlign: 'center',
  },
});
