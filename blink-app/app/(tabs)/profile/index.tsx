import React, { useCallback, useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Animated, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import {
  Settings,
  Camera,
  Flame,
  Users,
  ChevronRight,
  Bell as BellIcon,
  HelpCircle,
  Edit3,
  LogOut,
  Trash2,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import { useApp } from '@/providers/AppProvider';
import { api } from '@/services/api';
import { Skeleton, GlassCard } from '@/components/ui';
import StreakCalendar from '@/components/StreakCalendar';

// Animated stat card with staggered slide-up entrance
const AnimatedStatCard = React.memo(function AnimatedStatCard({
  children,
  index,
  style,
  padding,
}: {
  children: React.ReactNode;
  index: number;
  style?: object;
  padding?: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    const delay = 200 + index * 100;
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(timer);
  }, [index, opacity, translateY]);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      <GlassCard style={styles.statCard} padding={padding}>
        {children}
      </GlassCard>
    </Animated.View>
  );
});

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop';
const APP_VERSION = '1.0.0';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshGroups, isLoading, logout } = useApp();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshGroups();
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshGroups]);

  const handleLogout = useCallback(() => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: () => logout(),
      },
    ]);
  }, [logout]);

  const handleDeleteAccount = useCallback(() => {
    const doDelete = async () => {
      try {
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        await api('/auth/delete-account', { method: 'DELETE' });
        await logout();
      } catch {
        // Server-side delete failed -- still log out locally to unblock the user
        await logout();
      }
    };

    Alert.alert(
      'Delete Account',
      'This action is permanent and cannot be undone. All your data will be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: doDelete,
        },
      ]
    );
  }, [logout]);

  const menuItems = [
    { icon: Edit3, label: 'Edit Profile', color: theme.coral, route: '/edit-profile' },
    { icon: BellIcon, label: 'Notification Settings', color: theme.yellow, route: '/settings' },
    { icon: HelpCircle, label: 'Help & FAQ', color: theme.blue, route: '/help-faq' },
  ];

  const destructiveItems = [
    { icon: LogOut, label: 'Log Out', color: theme.textMuted, onPress: handleLogout },
    { icon: Trash2, label: 'Delete Account', color: theme.red, onPress: handleDeleteAccount },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={[typography.headlineLarge, { color: theme.text }]}>You</Text>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/settings' as never)}
          testID="settings-btn"
        >
          <Settings size={20} color={theme.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={theme.coral} />
        }
      >
        {/* ── Profile Card ── */}
        {isLoading ? (
          <GlassCard style={styles.profileCard}>
            <View style={styles.profileCardInner}>
              <Skeleton variant="circle" width={80} height={80} />
              <View style={{ marginTop: spacing.md, gap: spacing.xs, alignItems: 'center' }}>
                <Skeleton variant="text" width={140} height={24} />
                <Skeleton variant="text" width={100} height={16} />
              </View>
            </View>
          </GlassCard>
        ) : (
          <GlassCard style={styles.profileCard}>
            <View style={styles.profileCardInner}>
              <View style={styles.avatarRing}>
                <Image source={{ uri: user.avatar || DEFAULT_AVATAR }} style={styles.avatar} contentFit="cover" />
              </View>
              <Text style={[typography.displayMedium, { color: theme.text, marginTop: spacing.md }]}>
                {user.name}
              </Text>
              <Text style={[typography.bodyMedium, { color: theme.textSecondary, marginTop: spacing.xs }]}>
                {user.username}
              </Text>
              <TouchableOpacity
                style={styles.editProfileBtn}
                onPress={() => router.push('/edit-profile' as never)}
                activeOpacity={0.7}
              >
                <Edit3 size={13} color={theme.coral} />
                <Text style={styles.editProfileText}>Edit Profile</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        )}

        {/* ── Stats Row ── */}
        {isLoading ? (
          <View style={styles.statsRow}>
            {[0, 1, 2].map((i) => (
              <GlassCard key={i} style={styles.statCard} padding={spacing.md}>
                <Skeleton variant="circle" width={24} height={24} />
                <Skeleton variant="text" width={40} height={28} />
                <Skeleton variant="text" width={52} height={12} />
              </GlassCard>
            ))}
          </View>
        ) : (
          <View style={styles.statsRow}>
            <AnimatedStatCard index={0} style={{ flex: 1 }} padding={spacing.md}>
              <Camera size={20} color={theme.coral} />
              <Text style={[typography.statLarge, { color: theme.text }]}>{user.totalSnaps}</Text>
              <Text style={[typography.labelSmall, { color: theme.textMuted }]}>Blinks</Text>
            </AnimatedStatCard>

            <AnimatedStatCard index={1} style={{ flex: 1 }} padding={spacing.md}>
              <View style={styles.streakIconRow}>
                <Flame size={20} color={theme.yellow} />
              </View>
              <Text style={[typography.statLarge, { color: theme.text }]}>{user.longestStreak}</Text>
              <Text style={[typography.labelSmall, { color: theme.textMuted }]}>Best Streak</Text>
            </AnimatedStatCard>

            <AnimatedStatCard index={2} style={{ flex: 1 }} padding={spacing.md}>
              <Users size={20} color={theme.blue} />
              <Text style={[typography.statLarge, { color: theme.text }]}>{user.groupCount}</Text>
              <Text style={[typography.labelSmall, { color: theme.textMuted }]}>Groups</Text>
            </AnimatedStatCard>
          </View>
        )}

        {/* ── Streak Calendar ── */}
        {!isLoading && (
          <StreakCalendar
            totalSnaps={user.totalSnaps}
            longestStreak={user.longestStreak}
            joinDate={user.joinDate}
          />
        )}

        {/* ── Menu Section ── */}
        <GlassCard style={styles.menuCard} padding={0}>
          {menuItems.map((item, i) => {
            const IconComponent = item.icon;
            return (
              <TouchableOpacity
                key={i}
                style={[styles.menuItem, i < menuItems.length - 1 && styles.menuItemBorder]}
                activeOpacity={0.6}
                onPress={() => {
                  if (Platform.OS !== 'web') {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }
                  if (item.route) {
                    router.push(item.route as never);
                  }
                }}
              >
                <View style={[styles.menuIconBg, { backgroundColor: `${item.color}20` }]}>
                  <IconComponent size={18} color={item.color} />
                </View>
                <Text style={[typography.bodyLarge, styles.menuLabel]}>{item.label}</Text>
                <ChevronRight size={16} color={theme.textMuted} />
              </TouchableOpacity>
            );
          })}
        </GlassCard>

        {/* ── Destructive Actions ── */}
        <GlassCard style={styles.destructiveCard} padding={0}>
          {destructiveItems.map((item, i) => {
            const IconComponent = item.icon;
            const isLast = i === destructiveItems.length - 1;
            return (
              <TouchableOpacity
                key={i}
                style={[styles.menuItem, !isLast && styles.menuItemBorder]}
                activeOpacity={0.6}
                onPress={() => {
                  if (Platform.OS !== 'web') {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }
                  item.onPress();
                }}
              >
                <IconComponent size={18} color={item.color} />
                <Text
                  style={[
                    typography.bodyLarge,
                    styles.menuLabel,
                    { color: item.color === theme.red ? theme.red : theme.textSecondary },
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </GlassCard>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <Text style={[typography.bodySmall, { color: theme.textMuted }]}>
            Member since{' '}
            {new Date(user.joinDate).toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            })}
          </Text>
          <Text style={[typography.bodySmall, { color: theme.textMuted, marginTop: spacing.xs }]}>
            Blinks v{APP_VERSION}
          </Text>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
  },

  // Profile card
  profileCard: {
    marginBottom: spacing.xl,
  },
  profileCardInner: {
    alignItems: 'center',
  },
  avatarRing: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 3,
    borderColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  editProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  editProfileText: {
    ...typography.labelLarge,
    color: theme.coral,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  streakIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Menu
  menuCard: {
    marginBottom: spacing.md,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  menuItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.glassBorder,
  },
  menuIconBg: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    flex: 1,
    color: theme.text,
  },

  // Destructive
  destructiveCard: {
    marginBottom: spacing.xl,
  },

  // Footer
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
});
