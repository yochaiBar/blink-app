import React, { useRef, useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform, Modal } from 'react-native';
import { Image } from 'expo-image';
import { Lock, MoreHorizontal } from 'lucide-react-native';
import { SnapSubmission } from '@/types';
import { theme } from '@/constants/colors';
import { getRelativeTime } from '@/utils/time';
import * as Haptics from 'expo-haptics';

interface SnapCardProps {
  snap: SnapSubmission;
  isLocked: boolean;
  onReact?: (snapId: string, emoji: string) => void;
  onReport?: (snapId: string, userId: string) => void;
  onBlock?: (userId: string, userName: string) => void;
}

const quickReactions = ['😂', '🔥', '💀', '😍', '👀'];

export default React.memo(function SnapCard({ snap, isLocked, onReact, onReport, onBlock }: SnapCardProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [showMenu, setShowMenu] = useState(false);

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const handleReact = useCallback((emoji: string) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onReact?.(snap.id, emoji);
  }, [snap.id, onReact]);

  return (
    <Animated.View style={[styles.container, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        activeOpacity={1}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        testID={`snap-card-${snap.id}`}
      >
        <View style={styles.header}>
          <Image source={{ uri: snap.userAvatar }} style={styles.avatar} contentFit="cover" />
          <View style={styles.headerInfo}>
            <Text style={styles.userName}>{snap.userName}</Text>
            <Text style={styles.timestamp}>{getRelativeTime(snap.timestamp)}</Text>
          </View>
          {(onReport || onBlock) && (
            <TouchableOpacity
              style={styles.reportBtn}
              onPress={() => setShowMenu(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MoreHorizontal size={18} color={theme.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.imageContainer}>
          {isLocked ? (
            <View style={styles.lockedOverlay}>
              <Lock size={32} color={theme.textMuted} />
              <Text style={styles.lockedText}>Submit your snap to unlock</Text>
            </View>
          ) : (
            <Image
              source={{ uri: snap.imageUrl }}
              style={styles.image}
              contentFit="cover"
              transition={300}
            />
          )}
        </View>

        {!isLocked && (
          <View style={styles.footer}>
            <View style={styles.reactions}>
              {snap.reactions.map((reaction, i) => (
                <View key={i} style={styles.reactionBadge}>
                  <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                  <Text style={styles.reactionCount}>{reaction.count}</Text>
                </View>
              ))}
            </View>
            <View style={styles.quickReactions}>
              {quickReactions.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => handleReact(emoji)}
                  style={styles.quickReactBtn}
                >
                  <Text style={styles.quickReactEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </TouchableOpacity>

      {/* Action Menu */}
      <Modal visible={showMenu} transparent animationType="fade">
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowMenu(false)}>
          <View style={styles.menuContent} onStartShouldSetResponder={() => true}>
            {onReport && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowMenu(false);
                  onReport(snap.id, snap.userId);
                }}
              >
                <Text style={styles.menuItemText}>Report</Text>
              </TouchableOpacity>
            )}
            {onBlock && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowMenu(false);
                  onBlock(snap.userId, snap.userName);
                }}
              >
                <Text style={[styles.menuItemText, { color: theme.red }]}>Block {snap.userName}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.menuItem, styles.menuCancel]}
              onPress={() => setShowMenu(false)}
            >
              <Text style={[styles.menuItemText, { color: theme.textMuted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.bgCard,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
  },
  headerInfo: {
    flex: 1,
  },
  reportBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  userName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: theme.text,
  },
  timestamp: {
    fontSize: 12,
    color: theme.textMuted,
    marginTop: 1,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  lockedOverlay: {
    flex: 1,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  lockedText: {
    fontSize: 14,
    color: theme.textMuted,
    fontWeight: '500' as const,
  },
  footer: {
    padding: 12,
    gap: 10,
  },
  reactions: {
    flexDirection: 'row',
    gap: 8,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: theme.textSecondary,
  },
  quickReactions: {
    flexDirection: 'row',
    gap: 6,
  },
  quickReactBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickReactEmoji: {
    fontSize: 16,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  menuContent: {
    backgroundColor: theme.bgCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingBottom: 32,
  },
  menuItem: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: theme.text,
    textAlign: 'center',
  },
  menuCancel: {
    borderBottomWidth: 0,
    marginTop: 4,
  },
});
