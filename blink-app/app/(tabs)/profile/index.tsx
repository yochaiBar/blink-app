import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Settings, Camera, Flame, Users, Calendar, ChevronRight, Shield, Bell as BellIcon, HelpCircle, Edit3 } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import { LinearGradient } from 'expo-linear-gradient';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshGroups } = useApp();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshGroups();
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshGroups]);

  const stats = [
    { icon: Camera, label: 'Total Snaps', value: String(user.totalSnaps), color: theme.coral },
    { icon: Flame, label: 'Longest Streak', value: `${user.longestStreak} days`, color: theme.yellow },
    { icon: Users, label: 'Groups', value: String(user.groupCount), color: theme.blue },
  ];

  const menuSections = [
    {
      title: 'Account',
      items: [
        { icon: Edit3, label: 'Edit Profile', color: theme.coral, route: '/edit-profile' },
        { icon: BellIcon, label: 'Notifications', color: theme.yellow, route: '/settings' },
        { icon: Shield, label: 'Privacy', color: theme.green, route: '/settings' },
      ],
    },
    {
      title: 'More',
      items: [
        { icon: Calendar, label: 'Quiet Hours', color: theme.blue, route: '/settings' },
        { icon: HelpCircle, label: 'Help & FAQ', color: theme.purple, route: '/help-faq' },
      ],
    },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
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
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.coral}
          />
        }
      >
        <TouchableOpacity
          style={styles.profileSection}
          activeOpacity={0.8}
          onPress={() => router.push('/edit-profile' as never)}
        >
          <View style={styles.avatarContainer}>
            <Image source={{ uri: user.avatar }} style={styles.avatar} contentFit="cover" />
            <View style={styles.editAvatarBtn}>
              <Camera size={14} color={theme.white} />
            </View>
          </View>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.username}>{user.username}</Text>
          <Text style={styles.bio}>{user.bio}</Text>
        </TouchableOpacity>

        <View style={styles.statsContainer}>
          {stats.map((stat, i) => {
            const IconComponent = stat.icon;
            return (
              <LinearGradient
                key={i}
                colors={[`${stat.color}15`, `${stat.color}08`]}
                style={styles.statCard}
              >
                <IconComponent size={20} color={stat.color} />
                <Text style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </LinearGradient>
            );
          })}
        </View>

        {menuSections.map((section, sectionIndex) => (
          <View key={sectionIndex} style={styles.menuSection}>
            <Text style={styles.menuSectionTitle}>{section.title}</Text>
            <View style={styles.menuCard}>
              {section.items.map((item, i) => {
                const IconComponent = item.icon;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.menuItem, i < section.items.length - 1 && styles.menuItemBorder]}
                    onPress={() => {
                      if (item.route) {
                        router.push(item.route as never);
                      }
                    }}
                  >
                    <View style={[styles.menuIconBg, { backgroundColor: `${item.color}20` }]}>
                      <IconComponent size={18} color={item.color} />
                    </View>
                    <Text style={styles.menuLabel}>{item.label}</Text>
                    <ChevronRight size={16} color={theme.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.footer}>
          <Text style={styles.footerText}>Member since {new Date(user.joinDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
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
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: theme.text,
    letterSpacing: -0.5,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 14,
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: theme.coral,
  },
  editAvatarBtn: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: theme.bg,
  },
  name: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: theme.text,
  },
  username: {
    fontSize: 14,
    color: theme.textMuted,
    marginTop: 2,
  },
  bio: {
    fontSize: 14,
    color: theme.textSecondary,
    marginTop: 6,
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: theme.text,
  },
  statLabel: {
    fontSize: 11,
    color: theme.textMuted,
    textAlign: 'center',
  },
  menuSection: {
    marginBottom: 20,
  },
  menuSectionTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: theme.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  menuCard: {
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  menuItemBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
  },
  menuIconBg: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600' as const,
    color: theme.text,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  footerText: {
    fontSize: 12,
    color: theme.textMuted,
  },
});
