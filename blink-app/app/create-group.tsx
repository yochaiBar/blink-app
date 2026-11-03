import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import { Group } from '@/types';
import { Button } from '@/components/ui';

const emojiOptions = ['🔥', '💫', '🎯', '🌊', '⚡', '🎮', '🎵', '🏀', '🍕', '💎', '🦋', '🌸'];

export default function CreateGroupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { addGroup } = useApp();

  const [name, setName] = useState<string>('');
  const [selectedEmoji, setSelectedEmoji] = useState<string>('🔥');
  const [isCreating, setIsCreating] = useState<boolean>(false);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert('Hold up!', 'Give your group a name first');
      return;
    }

    setIsCreating(true);
    try {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      const newGroup: Group = {
        id: '',
        name: name.trim(),
        emoji: selectedEmoji,
        members: [],
        lastActive: new Date().toISOString(),
        hasActiveChallenge: false,
        color: theme.coral,
        inviteCode: '',
        createdAt: new Date().toISOString(),
      };

      await addGroup(newGroup);
      router.back();
    } catch {
      Alert.alert('Error', 'Could not create group. Please try again.');
    } finally {
      setIsCreating(false);
    }
  }, [name, selectedEmoji, addGroup, router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 10 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} testID="close-modal-btn">
          <X size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Group</Text>
        <TouchableOpacity
          onPress={handleCreate}
          style={[styles.createBtn, (!name.trim() || isCreating) && styles.createBtnDisabled]}
          disabled={!name.trim() || isCreating}
          testID="create-group-btn"
        >
          <Check size={18} color={name.trim() && !isCreating ? theme.white : theme.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.emojiPickerSection}>
          <View style={styles.selectedEmojiCircle}>
            <Text style={styles.selectedEmoji}>{selectedEmoji}</Text>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Group Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. The Crew, Study Squad..."
            placeholderTextColor={theme.textMuted}
            maxLength={30}
            autoFocus
            testID="group-name-input"
          />
          <Text style={styles.charCount}>{name.length}/30</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Group Emoji</Text>
          <View style={styles.emojiGrid}>
            {emojiOptions.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={[styles.emojiOption, selectedEmoji === emoji && styles.emojiOptionSelected]}
                onPress={() => {
                  setSelectedEmoji(emoji);
                  if (Platform.OS !== 'web') {
                    Haptics.selectionAsync();
                  }
                }}
              >
                <Text style={styles.emojiText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Button
          title={isCreating ? 'Creating...' : 'Create Group'}
          onPress={handleCreate}
          variant="primary"
          size="lg"
          loading={isCreating}
          disabled={!name.trim() || isCreating}
          fullWidth
        />

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
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  closeBtn: {
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
  createBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createBtnDisabled: {
    backgroundColor: theme.surface,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  emojiPickerSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  selectedEmojiCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    backgroundColor: `${theme.coral}20`,
    borderColor: `${theme.coral}40`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedEmoji: {
    fontSize: 36,
  },
  field: {
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: theme.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  input: {
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    padding: 16,
    fontSize: 17,
    color: theme.text,
    fontWeight: '600' as const,
    borderWidth: 1,
    borderColor: theme.border,
  },
  charCount: {
    fontSize: 12,
    color: theme.textMuted,
    textAlign: 'right',
    marginTop: 6,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  emojiOption: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: theme.border,
  },
  emojiOptionSelected: {
    borderColor: theme.coral,
    backgroundColor: theme.coralMuted,
  },
  emojiText: {
    fontSize: 22,
  },
  // bigCreateBtn styles replaced by shared Button component
});
