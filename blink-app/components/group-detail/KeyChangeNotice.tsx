import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import { getGroupDeviceKeys } from '@/services/api';
import { acceptKeyChange, changedKeys } from '@/services/keyPins';

export interface KeyChangeNoticeProps {
  groupId: string;
  currentUserId: string;
  /** Display names by user id, for the notice text. */
  memberNames: Record<string, string>;
}

/**
 * One row per member whose device key changed since this device pinned it
 * (TOFU, services/keyPins). Until accepted, we won't share the group key
 * with that key.
 */
export default function KeyChangeNotice({ groupId, currentUserId, memberNames }: KeyChangeNoticeProps) {
  const queryClient = useQueryClient();
  const queryKey = ['deviceKeys', groupId];
  const changesQuery = useQuery({
    queryKey,
    queryFn: async () => changedKeys((await getGroupDeviceKeys(groupId)).keys, currentUserId),
    enabled: !!groupId,
    staleTime: 60_000,
    retry: false,
  });

  const changes = changesQuery.data ?? [];
  if (changes.length === 0) return null;

  return (
    <View style={styles.container}>
      {changes.map((key) => (
        <View key={key.user_id} style={styles.row} testID={`key-change-${key.user_id}`}>
          <ShieldAlert size={18} color={theme.warning} />
          <View style={styles.textBlock}>
            <Text style={styles.title}>{`${memberNames[key.user_id] ?? 'A member'}'s security key changed`}</Text>
            <Text style={styles.detail}>
              This happens after a reinstall or a new phone. Accept only if you expect it.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.acceptBtn}
            onPress={async () => {
              await acceptKeyChange(key.user_id, key.x25519_public_key_b64);
              await queryClient.invalidateQueries({ queryKey });
            }}
          >
            <Text style={styles.acceptText}>Accept</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.warningMuted,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.warning,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  textBlock: { flex: 1 },
  title: { ...typography.bodyBold, color: theme.text },
  detail: { ...typography.caption, color: theme.textSecondary },
  acceptBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: theme.bgCardSolid,
  },
  acceptText: { ...typography.label, color: theme.warning },
});
