import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Platform } from 'react-native';
import { X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';

export type ChallengeType = 'snap' | 'quiz' | 'quiz_food' | 'quiz_most_likely' | 'quiz_rate_day';

const challengeTypes: { type: ChallengeType; emoji: string; label: string }[] = [
  { type: 'snap', emoji: '\u{1F4F8}', label: 'Snap Challenge' },
  { type: 'quiz_food', emoji: '\u{1F354}', label: 'Food Quiz' },
  { type: 'quiz_most_likely', emoji: '\u{1F440}', label: 'Most Likely To' },
  { type: 'quiz_rate_day', emoji: '\u2B50', label: 'Rate Your Day' },
];

export interface ChallengeTypeSelectorProps {
  visible: boolean;
  isPending: boolean;
  onClose: () => void;
  onSelect: (type: ChallengeType) => void;
}

export default function ChallengeTypeSelector({
  visible,
  isPending,
  onClose,
  onSelect,
}: ChallengeTypeSelectorProps) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={[typography.headlineLarge, { color: theme.text }]}>Start a Challenge</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <X size={20} color={theme.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.challengeGrid}>
            {challengeTypes.map((ct) => (
              <TouchableOpacity
                key={ct.type}
                style={styles.challengeTypeBtn}
                onPress={() => {
                  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onSelect(ct.type);
                }}
                disabled={isPending}
                activeOpacity={0.8}
              >
                <Text style={styles.challengeTypeEmoji}>{ct.emoji}</Text>
                <Text style={styles.challengeTypeLabel}>{ct.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.bgCardSolid,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    padding: spacing.xxl,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  challengeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  challengeTypeBtn: {
    width: '47%',
    backgroundColor: theme.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  challengeTypeEmoji: {
    fontSize: 32,
  },
  challengeTypeLabel: {
    ...typography.labelLarge,
    color: theme.text,
  },
});
