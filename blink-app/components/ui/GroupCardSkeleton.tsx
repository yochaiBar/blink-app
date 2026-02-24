import React from 'react';
import { View, StyleSheet } from 'react-native';
import { theme } from '@/constants/colors';
import Skeleton from './Skeleton';

export default React.memo(function GroupCardSkeleton() {
  return (
    <View style={styles.container}>
      {/* Top row: emoji + title area + chevron */}
      <View style={styles.topRow}>
        <View style={styles.titleArea}>
          <Skeleton variant="circle" width={36} height={36} borderRadius={10} />
          <View style={styles.titleLines}>
            <Skeleton variant="text" width={120} height={16} />
            <Skeleton variant="text" width={70} height={12} style={styles.categoryLine} />
          </View>
        </View>
        <Skeleton variant="rect" width={18} height={18} borderRadius={4} />
      </View>

      {/* Bottom row: avatar stack + meta */}
      <View style={styles.bottomRow}>
        <View style={styles.avatarStack}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.avatarWrap, { marginLeft: i > 0 ? -10 : 0, zIndex: 4 - i }]}>
              <Skeleton variant="circle" width={30} height={30} />
            </View>
          ))}
        </View>
        <Skeleton variant="rect" width={64} height={24} borderRadius={8} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.bgCard,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: theme.surfaceLight,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  titleArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  titleLines: {
    gap: 6,
  },
  categoryLine: {
    marginTop: 2,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    borderWidth: 2,
    borderColor: theme.bgCard,
    borderRadius: 15,
  },
});
