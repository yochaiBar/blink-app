import React, { useCallback, useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import AvatarRing from '@/components/ui/AvatarRing';

const TOOLTIP_AUTO_DISMISS_MS = 2000;

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
  const tooltipOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(tooltipOpacity, {
      toValue: isSelected ? 1 : 0,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [isSelected, tooltipOpacity]);

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
      <Animated.View
        pointerEvents="none"
        style={[styles.memberTooltip, { opacity: tooltipOpacity }]}
      >
        <Text style={styles.memberTooltipText} numberOfLines={1}>
          {member.name}
        </Text>
        <View style={styles.tooltipArrow} />
      </Animated.View>
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
    </TouchableOpacity>
  );
});

export interface MemberAvatarRowProps {
  members: MemberAvatarData[];
  respondedUserIds: Set<string>;
  hasActiveChallenge: boolean;
  currentUserId?: string;
}

export default function MemberAvatarRow({
  members,
  respondedUserIds,
  hasActiveChallenge,
  currentUserId,
}: MemberAvatarRowProps) {
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss tooltip after 2 seconds
  useEffect(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    if (selectedMemberId) {
      dismissTimer.current = setTimeout(() => {
        setSelectedMemberId(null);
      }, TOOLTIP_AUTO_DISMISS_MS);
    }
    return () => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
      }
    };
  }, [selectedMemberId]);

  // Filter out the current user from the avatar row
  const visibleMembers = currentUserId ? members.filter((m) => m.id !== currentUserId) : members;

  const respondedCount = hasActiveChallenge
    ? members.filter((m) => respondedUserIds.has(m.id)).length
    : 0;

  const handleMemberPress = useCallback((memberId: string) => {
    setSelectedMemberId((prev) => (prev === memberId ? null : memberId));
  }, []);

  return (
    <View style={styles.memberRingSection}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.memberRingRow}
      >
        {visibleMembers.map((member) => {
          const hasResponded = respondedUserIds.has(member.id);
          return (
            <AnimatedMemberAvatar
              key={member.id}
              member={member}
              hasResponded={hasResponded}
              hasActiveChallenge={hasActiveChallenge}
              isSelected={selectedMemberId === member.id}
              onPress={() => handleMemberPress(member.id)}
            />
          );
        })}
      </ScrollView>
      {hasActiveChallenge && visibleMembers.length > 0 && (
        <Text style={styles.respondedCount}>
          {respondedCount}/{visibleMembers.length + (currentUserId ? 1 : 0)} responded (incl. you)
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
    paddingTop: 28,
  },
  memberTooltip: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    zIndex: 10,
  },
  tooltipArrow: {
    position: 'absolute',
    bottom: -5,
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(0, 0, 0, 0.85)',
  },
  memberTooltipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 16,
    color: theme.white,
  },
  respondedCount: {
    ...typography.bodySmall,
    color: theme.textMuted,
    marginTop: spacing.sm,
  },
});
