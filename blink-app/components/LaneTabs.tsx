import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing } from '@/constants/spacing';

export type Lane = 'groups' | 'world' | 'foryou';

export const LANE_ACCENTS: Record<Lane, string> = {
  groups: theme.coral,
  world: theme.blue,
  foryou: theme.purple,
};

const LANES: Array<{ key: Lane; label: string }> = [
  { key: 'groups', label: 'Groups' },
  { key: 'world', label: 'World' },
  { key: 'foryou', label: 'For You' },
];

/**
 * Gentle underline tab switcher for the three Home lanes. The active lane
 * brightens to its accent colour with a thin underline — no filled button.
 */
export default function LaneTabs({
  active,
  onChange,
}: {
  active: Lane;
  onChange: (lane: Lane) => void;
}) {
  return (
    <View style={styles.bar}>
      {LANES.map(({ key, label }) => {
        const isOn = key === active;
        const accent = LANE_ACCENTS[key];
        return (
          <TouchableOpacity
            key={key}
            style={styles.tab}
            activeOpacity={0.7}
            onPress={() => {
              if (key === active) return;
              if (Platform.OS !== 'web') Haptics.selectionAsync();
              onChange(key);
            }}
          >
            <Text
              style={[
                styles.label,
                { color: isOn ? accent : theme.textMuted },
                isOn && styles.labelOn,
              ]}
            >
              {label}
            </Text>
            <View
              style={[
                styles.underline,
                { backgroundColor: isOn ? accent : 'transparent' },
              ]}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  label: {
    ...typography.labelLarge,
    fontWeight: '600',
    paddingBottom: spacing.sm,
  },
  labelOn: {
    fontWeight: '800',
  },
  underline: {
    height: 2,
    width: '55%',
    borderRadius: 2,
    marginBottom: -StyleSheet.hairlineWidth,
  },
});
