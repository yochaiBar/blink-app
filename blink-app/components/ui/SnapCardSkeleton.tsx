import React from 'react';
import { View, StyleSheet } from 'react-native';
import { theme } from '@/constants/colors';
import Skeleton from './Skeleton';

export default React.memo(function SnapCardSkeleton() {
  return (
    <View style={styles.container}>
      {/* Header: avatar + name/timestamp */}
      <View style={styles.header}>
        <Skeleton variant="circle" width={36} height={36} />
        <View style={styles.headerLines}>
          <Skeleton variant="text" width={100} height={14} />
          <Skeleton variant="text" width={60} height={11} style={styles.timestampLine} />
        </View>
      </View>

      {/* Image placeholder */}
      <View style={styles.imagePlaceholder}>
        <Skeleton variant="rect" width="100%" height="100%" borderRadius={0} />
      </View>

      {/* Footer: reactions + quick react buttons */}
      <View style={styles.footer}>
        <View style={styles.reactions}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rect" width={48} height={28} borderRadius={12} />
          ))}
        </View>
        <View style={styles.quickReactions}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} variant="circle" width={36} height={36} />
          ))}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.bgCard,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
  },
  headerLines: {
    gap: 4,
  },
  timestampLine: {
    marginTop: 2,
  },
  imagePlaceholder: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
  footer: {
    padding: 12,
    gap: 10,
  },
  reactions: {
    flexDirection: 'row',
    gap: 8,
  },
  quickReactions: {
    flexDirection: 'row',
    gap: 6,
  },
});
