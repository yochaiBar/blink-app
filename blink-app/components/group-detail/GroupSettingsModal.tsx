import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { UserPlus, Share2, Trash2, LogOut, X, Flag, KeyRound } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';

export interface GroupSettingsModalProps {
  visible: boolean;
  groupName: string;
  groupId: string;
  isAdmin: boolean;
  onClose: () => void;
  onInviteMembers: () => void;
  onShareGroup: () => void;
  onDeleteGroup: () => void;
  onLeaveGroup: () => void;
  onReportGroup: () => void;
  onResetKey?: () => void;
}

export default function GroupSettingsModal({
  visible,
  groupName,
  isAdmin,
  onClose,
  onInviteMembers,
  onShareGroup,
  onDeleteGroup,
  onLeaveGroup,
  onReportGroup,
  onResetKey,
}: GroupSettingsModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
          <View style={styles.modalHeader}>
            <Text style={[typography.headlineLarge, { color: theme.text }]}>{groupName}</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <X size={20} color={theme.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.menuList}>
            <TouchableOpacity style={styles.menuItem} onPress={onInviteMembers}>
              <UserPlus size={20} color={theme.text} />
              <Text style={styles.menuItemText}>Invite Members</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={onShareGroup}>
              <Share2 size={20} color={theme.text} />
              <Text style={styles.menuItemText}>Share Group</Text>
            </TouchableOpacity>

            {isAdmin && onResetKey && (
              <TouchableOpacity style={styles.menuItem} onPress={onResetKey}>
                <KeyRound size={20} color={theme.text} />
                <Text style={styles.menuItemText}>Reset Secure Key</Text>
              </TouchableOpacity>
            )}

            {isAdmin && (
              <TouchableOpacity style={styles.menuItem} onPress={onDeleteGroup}>
                <Trash2 size={20} color={theme.red} />
                <Text style={[styles.menuItemText, { color: theme.red }]}>Delete Group</Text>
              </TouchableOpacity>
            )}

            {!isAdmin && (
              <TouchableOpacity style={styles.menuItem} onPress={onLeaveGroup}>
                <LogOut size={20} color={theme.red} />
                <Text style={[styles.menuItemText, { color: theme.red }]}>Leave Group</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.menuItem} onPress={onReportGroup}>
              <Flag size={20} color={theme.yellow} />
              <Text style={[styles.menuItemText, { color: theme.yellow }]}>Report Group</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
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
  menuList: {
    gap: spacing.xs,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: spacing.xs,
  },
  menuItemText: {
    ...typography.bodyLarge,
    fontWeight: '600',
    color: theme.text,
  },
});
