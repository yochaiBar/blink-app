import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Platform, Alert, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import { GroupCategory, Group, AiPersonality } from '@/types';
import { categoryLabels } from '@/constants/categories';
import { Button } from '@/components/ui';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const categoryOptions: { key: GroupCategory; emoji: string; color: string }[] = [
  { key: 'close_friends', emoji: '💜', color: theme.coral },
  { key: 'family', emoji: '🏠', color: theme.yellow },
  { key: 'students', emoji: '📚', color: theme.blue },
  { key: 'work', emoji: '💼', color: theme.green },
  { key: 'custom', emoji: '✨', color: theme.purple },
];

const emojiOptions = ['🔥', '💫', '🎯', '🌊', '⚡', '🎮', '🎵', '🏀', '🍕', '💎', '🦋', '🌸'];

const personalityOptions: { key: AiPersonality; emoji: string; label: string; desc: string; color: string }[] = [
  { key: 'family_friendly', emoji: '🏠', label: 'Family', desc: 'Clean & wholesome', color: theme.green },
  { key: 'funny', emoji: '😂', label: 'Funny', desc: 'Jokes & humor', color: theme.yellow },
  { key: 'spicy', emoji: '🌶️', label: 'Spicy', desc: 'Bold & daring', color: theme.coral },
  { key: 'sarcastic', emoji: '😏', label: 'Sarcastic', desc: 'Witty & dry', color: theme.purple },
  { key: 'motivational', emoji: '💪', label: 'Hype', desc: 'Pump you up', color: theme.blue },
  { key: 'extreme', emoji: '🤯', label: 'Extreme', desc: 'Wild & crazy', color: theme.pink },
  { key: 'sexy', emoji: '🔥', label: 'Sexy', desc: 'Flirty vibes', color: '#FF69B4' },
  { key: 'no_filter', emoji: '💀', label: 'No Filter', desc: 'Roasts & chaos', color: theme.red },
];

export default function CreateGroupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { addGroup } = useApp();

  const [name, setName] = useState<string>('');
  const [category, setCategory] = useState<GroupCategory>('close_friends');
  const [selectedEmoji, setSelectedEmoji] = useState<string>('🔥');
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [personality, setPersonality] = useState<AiPersonality>('funny');

  const selectedCategoryOption = categoryOptions.find(c => c.key === category);

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
        category,
        emoji: selectedEmoji,
        members: [],
        lastActive: new Date().toISOString(),
        hasActiveChallenge: false,
        color: selectedCategoryOption?.color ?? theme.coral,
        inviteCode: '',
        createdAt: new Date().toISOString(),
        aiPersonality: personality,
      };

      await addGroup(newGroup);
      router.back();
    } catch {
      Alert.alert('Error', 'Could not create group. Please try again.');
    } finally {
      setIsCreating(false);
    }
  }, [name, category, selectedEmoji, personality, addGroup, router, selectedCategoryOption]);

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

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.emojiPickerSection}>
          <View style={[styles.selectedEmojiCircle, { backgroundColor: `${selectedCategoryOption?.color ?? theme.coral}20`, borderColor: `${selectedCategoryOption?.color ?? theme.coral}40` }]}>
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
          <Text style={styles.label}>Category</Text>
          <View style={styles.categoryGrid}>
            {categoryOptions.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.categoryOption,
                  category === opt.key && { backgroundColor: `${opt.color}20`, borderColor: `${opt.color}60` },
                ]}
                onPress={() => {
                  setCategory(opt.key);
                  if (Platform.OS !== 'web') {
                    Haptics.selectionAsync();
                  }
                }}
              >
                <Text style={styles.categoryEmoji}>{opt.emoji}</Text>
                <Text style={[styles.categoryLabel, category === opt.key && { color: opt.color }]}>
                  {categoryLabels[opt.key]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Group Emoji</Text>
          <View style={styles.emojiGrid}>
            {emojiOptions.map(emoji => (
              <TouchableOpacity
                key={emoji}
                style={[
                  styles.emojiOption,
                  selectedEmoji === emoji && styles.emojiOptionSelected,
                ]}
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

        <View style={styles.field}>
          <Text style={styles.label}>AI Vibe</Text>
          <Text style={styles.fieldDesc}>Choose how your group's AI will talk</Text>
          <View style={styles.personalityGrid}>
            {personalityOptions.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.personalityOption,
                  personality === opt.key && { backgroundColor: `${opt.color}20`, borderColor: `${opt.color}60` },
                ]}
                onPress={() => {
                  setPersonality(opt.key);
                  if (Platform.OS !== 'web') Haptics.selectionAsync();
                }}
              >
                <Text style={styles.personalityEmoji}>{opt.emoji}</Text>
                <Text style={[styles.personalityLabel, personality === opt.key && { color: opt.color }]}>
                  {opt.label}
                </Text>
                <Text style={styles.personalityDesc}>{opt.desc}</Text>
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
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.bgCard,
    borderWidth: 1.5,
    borderColor: theme.border,
  },
  categoryEmoji: {
    fontSize: 16,
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: theme.textSecondary,
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
  fieldDesc: {
    fontSize: 13,
    color: theme.textMuted,
    marginBottom: 12,
    marginTop: -4,
  },
  personalityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  personalityOption: {
    flexBasis: (SCREEN_WIDTH - 40 - 8) / 2,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: theme.bgCard,
    borderWidth: 1.5,
    borderColor: theme.border,
    gap: 4,
  },
  personalityEmoji: {
    fontSize: 24,
  },
  personalityLabel: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: theme.text,
  },
  personalityDesc: {
    fontSize: 11,
    color: theme.textMuted,
  },
  // bigCreateBtn styles replaced by shared Button component
});
