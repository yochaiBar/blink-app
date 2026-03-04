import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, UserPlus, Search } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import { LinearGradient } from 'expo-linear-gradient';
import { Button } from '@/components/ui';

export default function JoinGroupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { joinGroup } = useApp();
  const params = useLocalSearchParams<{ code?: string }>();

  const [code, setCode] = useState<string>(params.code?.toUpperCase() || '');
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleJoin = useCallback(async () => {
    if (!code.trim()) {
      setError('Please enter an invite code');
      return;
    }

    setIsJoining(true);
    setError('');

    try {
      const result = await joinGroup(code.trim().toUpperCase());
      if (result.success) {
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        Alert.alert('Joined!', `You're now a member of ${result.groupName}`, [
          { text: 'View Group', onPress: () => router.replace({ pathname: '/group-detail' as never, params: { id: result.groupId } }) },
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
        setError(result.message);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsJoining(false);
    }
  }, [code, joinGroup, router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Join Group</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.iconSection}>
          <LinearGradient
            colors={[`${theme.coral}20`, `${theme.coral}08`]}
            style={styles.iconCircle}
          >
            <UserPlus size={36} color={theme.coral} />
          </LinearGradient>
          <Text style={styles.title}>Enter Invite Code</Text>
          <Text style={styles.subtitle}>
            Ask a friend for their group code to join
          </Text>
        </View>

        <View style={styles.inputSection}>
          <View style={styles.inputWrapper}>
            <Search size={18} color={theme.textMuted} />
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={(text) => {
                setCode(text.toUpperCase());
                setError('');
              }}
              placeholder="e.g. CREW25"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="characters"
              maxLength={10}
              autoFocus
              returnKeyType="go"
              onSubmitEditing={handleJoin}
              testID="join-code-input"
            />
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <View style={styles.joinBtnWrapper}>
          <Button
            title={isJoining ? 'Joining...' : 'Join Group'}
            onPress={handleJoin}
            variant="primary"
            size="lg"
            loading={isJoining}
            disabled={!code.trim() || isJoining}
            fullWidth
          />
        </View>

        <View style={styles.tipCard}>
          <Text style={styles.tipEmoji}>💡</Text>
          <Text style={styles.tipText}>
            Codes are case-insensitive and usually 5-6 characters long. You can also join via a shared link.
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
  iconSection: {
    alignItems: 'center',
    marginBottom: 36,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: theme.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  inputSection: {
    marginBottom: 20,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.bgCard,
    borderRadius: 16,
    paddingHorizontal: 18,
    borderWidth: 1.5,
    borderColor: theme.border,
  },
  input: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700' as const,
    color: theme.text,
    paddingVertical: 18,
    letterSpacing: 3,
  },
  errorText: {
    fontSize: 13,
    color: theme.red,
    fontWeight: '600' as const,
    marginTop: 8,
    marginLeft: 4,
  },
  joinBtnWrapper: {
    marginBottom: 24,
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
