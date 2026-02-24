import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Platform, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Bell, Shield, Moon, LogOut, ChevronRight, Globe, Lock, Eye, Trash2, FileText } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import { api } from '@/services/api';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, updateProfile, logout } = useApp();

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(user.notificationsEnabled);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState<boolean>(Boolean(user.quietHoursStart));
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const handleToggleNotifications = useCallback((value: boolean) => {
    setNotificationsEnabled(value);
    updateProfile({ notificationsEnabled: value });
    Haptics.selectionAsync();
  }, [updateProfile]);

  const handleToggleQuietHours = useCallback((value: boolean) => {
    setQuietHoursEnabled(value);
    updateProfile({
      quietHoursStart: value ? '22:00' : undefined,
      quietHoursEnd: value ? '08:00' : undefined,
    });
    Haptics.selectionAsync();
  }, [updateProfile]);

  const handleLogout = useCallback(() => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out? All local data will be cleared.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            setIsLoggingOut(true);
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await logout();
              router.replace('/onboarding' as never);
            } catch {
              Alert.alert('Error', 'Could not log out. Please try again.');
            } finally {
              setIsLoggingOut(false);
            }
          },
        },
      ]
    );
  }, [logout, router]);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete all your data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              await api('/auth/delete-account', { method: 'DELETE' });
              await logout();
              router.replace('/onboarding' as never);
            } catch {
              // If API fails, still log out locally
              await logout();
              router.replace('/onboarding' as never);
            }
          },
        },
      ]
    );
  }, [logout, router]);

  const privacyOptions: { key: 'everyone' | 'friends' | 'groups_only'; label: string; icon: typeof Globe }[] = [
    { key: 'everyone', label: 'Everyone', icon: Globe },
    { key: 'friends', label: 'Friends Only', icon: Eye },
    { key: 'groups_only', label: 'Groups Only', icon: Lock },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={[styles.iconBg, { backgroundColor: theme.coralMuted }]}>
                <Bell size={18} color={theme.coral} />
              </View>
              <Text style={styles.settingLabel}>Push Notifications</Text>
              <Switch
                value={notificationsEnabled}
                onValueChange={handleToggleNotifications}
                trackColor={{ false: theme.surface, true: theme.coral }}
                thumbColor={theme.white}
              />
            </View>

            <View style={styles.rowDivider} />

            <View style={styles.settingRow}>
              <View style={[styles.iconBg, { backgroundColor: theme.blueMuted }]}>
                <Moon size={18} color={theme.blue} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Quiet Hours</Text>
                {quietHoursEnabled && (
                  <Text style={styles.settingDesc}>10:00 PM - 8:00 AM</Text>
                )}
              </View>
              <Switch
                value={quietHoursEnabled}
                onValueChange={handleToggleQuietHours}
                trackColor={{ false: theme.surface, true: theme.blue }}
                thumbColor={theme.white}
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy</Text>
          <View style={styles.card}>
            <Text style={styles.privacyLabel}>Who can see your snaps</Text>
            {privacyOptions.map((opt) => {
              const IconComp = opt.icon;
              const isSelected = user.privacyMode === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.privacyOption, isSelected && styles.privacyOptionSelected]}
                  onPress={() => {
                    updateProfile({ privacyMode: opt.key });
                    Haptics.selectionAsync();
                  }}
                >
                  <IconComp size={18} color={isSelected ? theme.coral : theme.textMuted} />
                  <Text style={[styles.privacyOptionText, isSelected && { color: theme.coral }]}>
                    {opt.label}
                  </Text>
                  {isSelected && (
                    <View style={styles.selectedDot} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.settingRow} onPress={() => Linking.openURL('https://blink.app/privacy')}>
              <View style={[styles.iconBg, { backgroundColor: theme.greenMuted }]}>
                <Shield size={18} color={theme.green} />
              </View>
              <Text style={styles.settingLabel}>Privacy Policy</Text>
              <ChevronRight size={16} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={styles.rowDivider} />

            <TouchableOpacity style={styles.settingRow} onPress={() => Linking.openURL('https://blink.app/terms')}>
              <View style={[styles.iconBg, { backgroundColor: theme.blueMuted }]}>
                <FileText size={18} color={theme.blue} />
              </View>
              <Text style={styles.settingLabel}>Terms of Service</Text>
              <ChevronRight size={16} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={styles.rowDivider} />

            <TouchableOpacity
              style={styles.settingRow}
              onPress={handleLogout}
              disabled={isLoggingOut}
            >
              <View style={[styles.iconBg, { backgroundColor: theme.redMuted }]}>
                <LogOut size={18} color={theme.red} />
              </View>
              <Text style={[styles.settingLabel, { color: theme.red }]}>
                {isLoggingOut ? 'Logging out...' : 'Log Out'}
              </Text>
              <ChevronRight size={16} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={styles.rowDivider} />

            <TouchableOpacity style={styles.settingRow} onPress={handleDeleteAccount}>
              <View style={[styles.iconBg, { backgroundColor: theme.redMuted }]}>
                <Trash2 size={18} color={theme.red} />
              </View>
              <Text style={[styles.settingLabel, { color: theme.red }]}>Delete Account</Text>
              <ChevronRight size={16} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Blink v1.0.0</Text>
          <Text style={styles.footerText}>Made with 📸 for your crew</Text>
        </View>

        <View style={{ height: 40 }} />
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
    fontSize: 18,
    fontWeight: '800' as const,
    color: theme.text,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: theme.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: theme.bgCard,
    borderRadius: 16,
    padding: 4,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  settingInfo: {
    flex: 1,
  },
  rowDivider: {
    height: 0.5,
    backgroundColor: theme.border,
    marginHorizontal: 14,
  },
  iconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600' as const,
    color: theme.text,
  },
  settingDesc: {
    fontSize: 12,
    color: theme.textMuted,
    marginTop: 2,
  },
  privacyLabel: {
    fontSize: 13,
    color: theme.textSecondary,
    padding: 14,
    paddingBottom: 8,
  },
  privacyOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 4,
    marginBottom: 4,
    borderRadius: 12,
  },
  privacyOptionSelected: {
    backgroundColor: theme.coralMuted,
  },
  privacyOptionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600' as const,
    color: theme.textSecondary,
  },
  selectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.coral,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 4,
  },
  footerText: {
    fontSize: 12,
    color: theme.textMuted,
  },
});
