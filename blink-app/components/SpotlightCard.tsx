import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Image } from 'expo-image';
import { Star } from 'lucide-react-native';
import { DailySpotlight } from '@/types';
import { theme } from '@/constants/colors';
import { LinearGradient } from 'expo-linear-gradient';

interface SpotlightCardProps {
  spotlight: DailySpotlight;
}

export default React.memo(function SpotlightCard({ spotlight }: SpotlightCardProps) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [shimmerAnim]);

  const glowOpacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0.8],
  });

  return (
    <View style={styles.wrapper}>
      <LinearGradient
        colors={['#FFD84D22', '#FF6B4A22', '#A78BFA22']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.container}
      >
        <View style={styles.header}>
          <Animated.View style={[styles.starGlow, { opacity: glowOpacity }]}>
            <Star size={16} color={theme.yellow} fill={theme.yellow} />
          </Animated.View>
          <Text style={styles.title}>{spotlight.title}</Text>
        </View>

        <View style={styles.profileRow}>
          <View style={styles.avatarRing}>
            <Image
              source={{ uri: spotlight.userAvatar }}
              style={styles.avatar}
              contentFit="cover"
            />
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.name}>{spotlight.userName}</Text>
            <Text style={styles.subtitle}>{spotlight.subtitle}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          {spotlight.stats.map((stat, i) => (
            <View key={i} style={styles.statItem}>
              <Text style={styles.statEmoji}>{stat.emoji}</Text>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 16,
    borderRadius: 20,
    overflow: 'hidden',
  },
  container: {
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 216, 77, 0.2)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  starGlow: {},
  title: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: theme.yellow,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  avatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: theme.yellow,
    padding: 2,
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
  },
  profileInfo: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: theme.text,
  },
  subtitle: {
    fontSize: 13,
    color: theme.textSecondary,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    gap: 2,
  },
  statEmoji: {
    fontSize: 18,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: theme.text,
  },
  statLabel: {
    fontSize: 11,
    color: theme.textMuted,
  },
});
