import React, { useCallback, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import AvatarRing from '@/components/ui/AvatarRing';

export interface MemberAvatarData {
  id: string;
  name: string;
  avatar: string;
}

interface AnimatedMemberAvatarProps {
  member: MemberAvatarData;
  hasResponded: boolean;
  hasActiveChallenge: boolean;
  isSelected: boolean;
  onPress: () => void;
}

const AnimatedMemberAvatar = React.memo(function AnimatedMemberAvatar({
  member,
  hasResponded,
  hasActiveChallenge,
  isSelected,
  onPress,
}: AnimatedMemberAvatarProps) {
  const springScale = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Animated.sequence([
      Animated.spring(springScale, { toValue: 0.8, useNativeDriver: true, speed: 50, bounciness: 4 }),
      Animated.spring(springScale, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 10 }),
    ]).start();
    onPress();
  }, [onPress, springScale]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={1}
      style={styles.memberRingItem}
    >
      <Animated.View style={{ transform: [{ scale: springScale }] }}>
        <AvatarRing
          uri={member.avatar}
          name={member.name}
          size={46}
          hasResponded={hasResponded}
          showStatus={hasActiveChallenge}
          isActive={hasActiveChallenge && !hasResponded}
        />
      </Animated.View>
      {isSelected && (
        <View style={styles.memberTooltip}>
          <Text style={styles.memberTooltipText} numberOfLines={1}>
            {member.name}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

export interface MemberAvatarRowProps {
  members: MemberAvatarData[];
  respondedUserIds: Set<string>;
  hasActiveChallenge: boolean;
}

export default function MemberAvatarRow({
  members,
  respondedUserIds,
  hasActiveChallenge,
}: MemberAvatarRowProps) {
  const [tooltipName, setTooltipName] = useState<string | null>(null);

  const respondedCount = hasActiveChallenge
    ? members.filter((m) => respondedUserIds.has(m.id)).length
    : 0;

  return (
    <View style={styles.memberRingSection}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.memberRingRow}
      >
        {members.map((member) => {
          const hasResponded = respondedUserIds.has(member.id);
          return (
            <AnimatedMemberAvatar
              key={member.id}
              member={member}
              hasResponded={hasResponded}
              hasActiveChallenge={hasActiveChallenge}
              isSelected={tooltipName === member.name}
              onPress={() => setTooltipName(tooltipName === member.name ? null : member.name)}
            />
          );
        })}
      </ScrollView>
      {hasActiveChallenge && members.length > 0 && (
        <Text style={styles.respondedCount}>
          {respondedCount}/{members.length} responded
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  memberRingSection: {
    marginBottom: spacing.lg,
  },
  memberRingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  memberRingItem: {
    alignItems: 'center',
  },
  memberTooltip: {
    position: 'absolute',
    bottom: -20,
    backgroundColor: theme.bgCardSolid,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.border,
  },
  memberTooltipText: {
    ...typography.bodySmall,
    color: theme.text,
    fontWeight: '600',
  },
  respondedCount: {
    ...typography.bodySmall,
    color: theme.textMuted,
    marginTop: spacing.sm,
  },
});
