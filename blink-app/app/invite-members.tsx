import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert, Share } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Copy, Share2, Link, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import { LinearGradient } from 'expo-linear-gradient';
import { Button } from '@/components/ui';

export default function InviteMembersScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { groups } = useApp();
  const [copied, setCopied] = useState<boolean>(false);
  const [linkCopied, setLinkCopied] = useState<boolean>(false);

  const group = groups.find(g => g.id === groupId);
  const inviteCode = group?.inviteCode || '------';
  const inviteLink = `https://blink.app/join/${inviteCode}`;

  const handleCopyCode = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(inviteCode);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert('Copied!', `Code: ${inviteCode}`);
    }
  }, [inviteCode]);

  const handleCopyLink = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(inviteLink);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      Alert.alert('Copied!', 'Invite link copied to clipboard');
    }
  }, [inviteLink]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message: `Join ${group?.name ?? 'my group'} on Blink! Use code: ${inviteCode} or tap: ${inviteLink}`,
      });
    } catch {
      // Non-critical: user may have cancelled the share sheet
    }
  }, [group, inviteCode, inviteLink]);

  if (!group) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>Group not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Invite Friends</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.groupInfo}>
          <Text style={styles.groupEmoji}>{group.emoji}</Text>
          <Text style={styles.groupName}>{group.name}</Text>
          <Text style={styles.groupMembers}>{group.members.length} members</Text>
        </View>

        <LinearGradient
          colors={[`${group.color}15`, `${group.color}08`]}
          style={styles.codeCard}
        >
          <Text style={styles.codeLabel}>INVITE CODE</Text>
          <Text style={[styles.codeText, { color: group.color }]}>{inviteCode}</Text>
          <Button
            title={copied ? 'Copied!' : 'Copy Code'}
            onPress={handleCopyCode}
            variant="secondary"
            size="md"
            icon={copied ? <Check size={16} color={theme.green} /> : <Copy size={16} color={group.color} />}
          />
        </LinearGradient>

        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>or share via</Text>
          <View style={styles.divider} />
        </View>

        <View style={styles.shareButtons}>
          <Button
            title={linkCopied ? 'Copied!' : 'Copy Link'}
            onPress={handleCopyLink}
            variant="secondary"
            size="md"
            icon={linkCopied ? <Check size={18} color={theme.green} /> : <Link size={18} color={theme.blue} />}
          />
          <Button
            title="Share Link"
            onPress={handleShare}
            variant="primary"
            size="md"
            icon={<Share2 size={18} color={theme.white} />}
          />
        </View>

        <View style={styles.tipCard}>
          <Text style={styles.tipEmoji}>💡</Text>
          <Text style={styles.tipText}>
            Friends can join by entering the code in the app or tapping the invite link
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  errorText: {
    fontSize: 16,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: 40,
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
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  groupInfo: {
    alignItems: 'center',
    marginBottom: 28,
  },
  groupEmoji: {
    fontSize: 44,
    marginBottom: 8,
  },
  groupName: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: theme.text,
  },
  groupMembers: {
    fontSize: 14,
    color: theme.textSecondary,
    marginTop: 4,
  },
  codeCard: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  codeLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: theme.textMuted,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  codeText: {
    fontSize: 36,
    fontWeight: '900' as const,
    letterSpacing: 4,
    marginBottom: 16,
  },
  // copyBtn styles replaced by shared Button component
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: theme.border,
  },
  dividerText: {
    fontSize: 12,
    color: theme.textMuted,
    marginHorizontal: 14,
  },
  shareButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 28,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.bgCard,
    padding: 16,
    borderRadius: 14,
  },
  tipEmoji: {
    fontSize: 20,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    color: theme.textSecondary,
    lineHeight: 18,
  },
});
