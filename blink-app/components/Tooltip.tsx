import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback, Dimensions } from 'react-native';
import { theme } from '@/constants/colors';

export interface TargetLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TooltipProps {
  visible: boolean;
  message: string;
  targetLayout: TargetLayout | null;
  position: 'above' | 'below';
  onNext: () => void;
  onDismiss: () => void;
  nextLabel: string;
  step: number;
  totalSteps: number;
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const ARROW_SIZE = 10;
const TOOLTIP_MARGIN = 16;
const SPOTLIGHT_PADDING = 6;

export default function Tooltip({
  visible,
  message,
  targetLayout,
  position,
  onNext,
  onDismiss,
  nextLabel,
  step,
  totalSteps,
}: TooltipProps) {
  if (!visible || !targetLayout) return null;

  const spotlightStyle = {
    top: targetLayout.y - SPOTLIGHT_PADDING,
    left: targetLayout.x - SPOTLIGHT_PADDING,
    width: targetLayout.width + SPOTLIGHT_PADDING * 2,
    height: targetLayout.height + SPOTLIGHT_PADDING * 2,
    borderRadius: 14,
  };

  const tooltipWidth = SCREEN_WIDTH - TOOLTIP_MARGIN * 2;

  const tooltipStyle =
    position === 'below'
      ? {
          top: targetLayout.y + targetLayout.height + SPOTLIGHT_PADDING + ARROW_SIZE + 4,
          left: TOOLTIP_MARGIN,
          width: tooltipWidth,
        }
      : {
          top: targetLayout.y - SPOTLIGHT_PADDING - ARROW_SIZE - 4 - 100, // estimate height
          left: TOOLTIP_MARGIN,
          width: tooltipWidth,
        };

  // Arrow centered on target
  const arrowLeft = Math.min(
    Math.max(targetLayout.x + targetLayout.width / 2 - ARROW_SIZE, TOOLTIP_MARGIN + 16),
    SCREEN_WIDTH - TOOLTIP_MARGIN - 16 - ARROW_SIZE * 2,
  );

  const arrowStyle =
    position === 'below'
      ? {
          top: targetLayout.y + targetLayout.height + SPOTLIGHT_PADDING,
          left: arrowLeft,
          borderLeftWidth: ARROW_SIZE,
          borderRightWidth: ARROW_SIZE,
          borderBottomWidth: ARROW_SIZE,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: theme.bgElevated,
        }
      : {
          top: targetLayout.y - SPOTLIGHT_PADDING - ARROW_SIZE,
          left: arrowLeft,
          borderLeftWidth: ARROW_SIZE,
          borderRightWidth: ARROW_SIZE,
          borderTopWidth: ARROW_SIZE,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: theme.bgElevated,
        };

  return (
    <TouchableWithoutFeedback onPress={onDismiss}>
      <View style={styles.overlay}>
        {/* Spotlight cutout border */}
        <View style={[styles.spotlight, spotlightStyle]} pointerEvents="none" />

        {/* Arrow */}
        <View style={[styles.arrow, arrowStyle]} pointerEvents="none" />

        {/* Tooltip bubble */}
        <View style={[styles.tooltip, tooltipStyle]}>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.footer}>
            <Text style={styles.stepIndicator}>
              {step}/{totalSteps}
            </Text>
            <TouchableOpacity style={styles.nextButton} onPress={onNext} activeOpacity={0.8}>
              <Text style={styles.nextButtonText}>{nextLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 1000,
  },
  spotlight: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: theme.coral,
    backgroundColor: 'transparent',
  },
  arrow: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: theme.bgElevated,
    borderRadius: 16,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  message: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.text,
    lineHeight: 22,
    marginBottom: 14,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepIndicator: {
    fontSize: 13,
    color: theme.textMuted,
    fontWeight: '600',
  },
  nextButton: {
    backgroundColor: theme.coral,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  nextButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.white,
  },
});
