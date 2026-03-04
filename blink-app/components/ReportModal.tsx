import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, Alert, Platform } from 'react-native';
import { X, Flag } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { reportContent } from '@/services/api';

const reportReasons = [
  { key: 'inappropriate', label: 'Inappropriate', emoji: '⚠️' },
  { key: 'spam', label: 'Spam', emoji: '🚫' },
  { key: 'harassment', label: 'Harassment', emoji: '😤' },
  { key: 'hate_speech', label: 'Hate Speech', emoji: '🚨' },
  { key: 'nudity', label: 'Nudity', emoji: '🔞' },
  { key: 'violence', label: 'Violence', emoji: '⛔' },
  { key: 'other', label: 'Other', emoji: '📝' },
];

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  reportedUserId?: string;
  reportedContentId?: string;
  contentType: 'photo' | 'user' | 'group' | 'challenge_response';
}

export default function ReportModal({ visible, onClose, reportedUserId, reportedContentId, contentType }: ReportModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!selectedReason) return;
    setIsSubmitting(true);
    try {
      await reportContent({
        reported_user_id: reportedUserId,
        reported_content_id: reportedContentId,
        content_type: contentType,
        reason: selectedReason,
        description: description.trim() || undefined,
      });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Report Submitted', 'Thank you. We will review this shortly.');
      setSelectedReason('');
      setDescription('');
      onClose();
    } catch {
      Alert.alert('Error', 'Could not submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedReason, description, reportedUserId, reportedContentId, contentType, onClose]);

  const handleClose = useCallback(() => {
    setSelectedReason('');
    setDescription('');
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide">
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleClose}>
        <View style={styles.content} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Flag size={20} color={theme.coral} />
              <Text style={styles.title}>Report</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <X size={20} color={theme.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>Why are you reporting this?</Text>

          <View style={styles.reasonGrid}>
            {reportReasons.map((r) => (
              <TouchableOpacity
                key={r.key}
                style={[styles.reasonChip, selectedReason === r.key && styles.reasonChipSelected]}
                onPress={() => {
                  setSelectedReason(r.key);
                  if (Platform.OS !== 'web') Haptics.selectionAsync();
                }}
              >
                <Text style={styles.reasonEmoji}>{r.emoji}</Text>
                <Text style={[styles.reasonLabel, selectedReason === r.key && styles.reasonLabelSelected]}>{r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.descInput}
            placeholder="Add details (optional)"
            placeholderTextColor={theme.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={500}
          />

          <TouchableOpacity
            style={[styles.submitBtn, (!selectedReason || isSubmitting) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!selectedReason || isSubmitting}
          >
            <Text style={styles.submitBtnText}>{isSubmitting ? 'Submitting...' : 'Submit Report'}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: theme.bgCard,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.text,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: 16,
  },
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  reasonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: theme.border,
  },
  reasonChipSelected: {
    backgroundColor: theme.coralMuted,
    borderColor: theme.coral,
  },
  reasonEmoji: {
    fontSize: 14,
  },
  reasonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  reasonLabelSelected: {
    color: theme.coral,
  },
  descInput: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: theme.text,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  submitBtn: {
    backgroundColor: theme.coral,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    backgroundColor: theme.surface,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.white,
  },
});
