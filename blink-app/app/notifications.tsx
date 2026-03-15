import React, { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Bell, Camera, Heart, MessageCircle, Flame, UserPlus, Star, Mail } from 'lucide-react-native';
import { Image } from 'expo-image';
import { theme } from '@/constants/colors';
import { useNotifications } from '@/hooks/useNotifications';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { NotificationItem } from '@/types';
import { getRelativeTime } from '@/utils/time';

const notifIcons: Record<string, { icon: typeof Bell; color: string }> = {
  challenge: { icon: Camera, color: theme.coral },
  reaction: { icon: Heart, color: theme.pink },
  prompt: { icon: MessageCircle, color: theme.blue },
  streak: { icon: Flame, color: theme.yellow },
  join: { icon: UserPlus, color: theme.green },
  spotlight: { icon: Star, color: theme.yellow },
  invite: { icon: Mail, color: theme.purple },
};

function NotificationSkeleton() {
  return (
    <View style={styles.skeletonRow}>
      <Skeleton variant="circle" width={44} height={44} />
      <View style={styles.skeletonContent}>
        <Skeleton variant="text" width={160} height={15} />
        <Skeleton variant="text" width={200} height={13} />
        <Skeleton variant="text" width={90} height={12} />
      </View>
    </View>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    notifications,
    markNotificationsRead,
    isNotificationsLoading,
    isNotificationsError,
    refetchNotifications,
  } = useNotifications();

  useEffect(() => {
    const timer = setTimeout(() => {
      markNotificationsRead();
    }, 1000);
    return () => clearTimeout(timer);
  }, [markNotificationsRead]);

  const renderNotification = useCallback(({ item }: { item: NotificationItem }) => {
    const config = notifIcons[item.type] ?? { icon: Bell, color: theme.textMuted };
    const IconComp = config.icon;

    return (
      <TouchableOpacity
        style={[styles.notifRow, !item.read && styles.notifUnread]}
        activeOpacity={0.7}
        onPress={() => {
          if (item.groupId) {
            router.push({ pathname: '/group-detail' as never, params: { id: item.groupId } });
          }
        }}
        testID={`notif-${item.id}`}
      >
        <View style={styles.notifLeft}>
          {item.fromUserAvatar ? (
            <View style={styles.avatarWithBadge}>
              <Image source={{ uri: item.fromUserAvatar }} style={styles.avatar} contentFit="cover" />
              <View style={[styles.typeBadge, { backgroundColor: config.color }]}>
                <IconComp size={10} color={theme.white} />
              </View>
            </View>
          ) : (
            <View style={[styles.iconCircle, { backgroundColor: `${config.color}18` }]}>
              <IconComp size={20} color={config.color} />
            </View>
          )}
        </View>

        <View style={styles.notifContent}>
          <Text style={styles.notifTitle}>{item.title}</Text>
          <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
          <View style={styles.notifMeta}>
            {item.groupName && (
              <>
                <Text style={styles.notifGroup}>{item.groupName}</Text>
                <Text style={styles.notifDot}>{'\u00B7'}</Text>
              </>
            )}
            <Text style={styles.notifTime}>{getRelativeTime(item.timestamp)}</Text>
          </View>
        </View>

        {!item.read && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  }, [router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="notif-back-btn">
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Loading state */}
      {isNotificationsLoading && (
        <View style={styles.loadingContainer}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <NotificationSkeleton key={i} />
          ))}
        </View>
      )}

      {/* Error state */}
      {isNotificationsError && !isNotificationsLoading && (
        <ErrorState
          message="Could not load notifications"
          onRetry={() => refetchNotifications()}
        />
      )}

      {/* Data */}
      {!isNotificationsLoading && !isNotificationsError && (
        <FlatList
          data={notifications}
          renderItem={renderNotification}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              emoji="🔔"
              title="All caught up!"
              subtitle="You'll see notifications from your groups here"
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: theme.text,
  },
  loadingContainer: {
    paddingHorizontal: 16,
    gap: 4,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  skeletonContent: {
    flex: 1,
    gap: 6,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 4,
  },
  notifUnread: {
    backgroundColor: `${theme.coral}08`,
  },
  notifLeft: {},
  avatarWithBadge: {
    position: 'relative',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  typeBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.bg,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifContent: {
    flex: 1,
    gap: 3,
  },
  notifTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: theme.text,
  },
  notifBody: {
    fontSize: 13,
    color: theme.textSecondary,
    lineHeight: 18,
  },
  notifMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  notifGroup: {
    fontSize: 12,
    color: theme.coral,
    fontWeight: '600' as const,
  },
  notifDot: {
    fontSize: 12,
    color: theme.textMuted,
  },
  notifTime: {
    fontSize: 12,
    color: theme.textMuted,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.coral,
    marginTop: 6,
  },
});
