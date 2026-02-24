import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { ActivityItem } from '@/types';
import { theme } from '@/constants/colors';
import { getRelativeTimeShort } from '@/utils/time';

const typeIcons: Record<string, string> = {
  snap: '📸',
  join: '👋',
  spotlight: '⭐',
  quiz: '🧠',
  prompt: '💬',
};

interface ActivityRowProps {
  item: ActivityItem;
}

export default React.memo(function ActivityRow({ item }: ActivityRowProps) {
  return (
    <View style={styles.container} testID={`activity-row-${item.id}`}>
      <View style={styles.avatarArea}>
        <Image source={{ uri: item.userAvatar }} style={styles.avatar} contentFit="cover" />
        <Text style={styles.typeIcon}>{typeIcons[item.type] ?? '📌'}</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.text} numberOfLines={2}>
          <Text style={styles.userName}>{item.userName}</Text>
          {' '}{item.message}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.groupName}>{item.groupName}</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.timestamp}>{getRelativeTimeShort(item.timestamp)}</Text>
        </View>
      </View>

      {item.imageUrl && (
        <Image source={{ uri: item.imageUrl }} style={styles.thumbnail} contentFit="cover" />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
  },
  avatarArea: {
    position: 'relative',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  typeIcon: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    fontSize: 14,
    backgroundColor: theme.bg,
    borderRadius: 10,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    gap: 4,
  },
  text: {
    fontSize: 14,
    color: theme.textSecondary,
    lineHeight: 19,
  },
  userName: {
    fontWeight: '700' as const,
    color: theme.text,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  groupName: {
    fontSize: 12,
    color: theme.coral,
    fontWeight: '600' as const,
  },
  dot: {
    fontSize: 12,
    color: theme.textMuted,
  },
  timestamp: {
    fontSize: 12,
    color: theme.textMuted,
  },
  thumbnail: {
    width: 46,
    height: 46,
    borderRadius: 10,
  },
});
