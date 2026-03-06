import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';

export interface ShareCardProps {
  photoUri: string;
  prompt: string;
  userName: string;
  userAvatar: string;
  groupName: string;
  groupEmoji?: string;
  responseTimeSec?: number;
}

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;

/**
 * A 9:16 story-sized card (1080x1920 logical pixels) designed for
 * sharing to Instagram Stories and similar platforms.
 *
 * This component is rendered off-screen and captured via
 * react-native-view-shot. It should be wrapped in a
 * React.forwardRef-compatible container so the parent can
 * pass a ref for capture.
 */
export default function ShareCard({
  photoUri,
  prompt,
  userName,
  userAvatar,
  groupName,
  groupEmoji,
  responseTimeSec,
}: ShareCardProps) {
  const responseLabel =
    responseTimeSec != null && responseTimeSec > 0
      ? `responded in ${responseTimeSec}s`
      : null;

  return (
    <View style={styles.card}>
      {/* ── Header ─────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.logoText}>Blink</Text>
        <View style={styles.groupPill}>
          {groupEmoji ? (
            <Text style={styles.groupEmoji}>{groupEmoji}</Text>
          ) : null}
          <Text style={styles.groupName} numberOfLines={1}>
            {groupName}
          </Text>
        </View>
      </View>

      {/* ── Photo area (roughly 4:5 within the card) ─────── */}
      <View style={styles.photoWrapper}>
        <Image
          source={{ uri: photoUri }}
          style={styles.photo}
          contentFit="cover"
        />

        {/* Prompt scrim overlay at the bottom of the photo */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.85)']}
          style={styles.promptOverlay}
          pointerEvents="none"
        >
          <Text style={styles.promptText} numberOfLines={3}>
            {prompt}
          </Text>
        </LinearGradient>
      </View>

      {/* ── Footer ─────────────────────────────────────────── */}
      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <View style={styles.avatarContainer}>
            {userAvatar ? (
              <Image
                source={{ uri: userAvatar }}
                style={styles.avatar}
                contentFit="cover"
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>
                  {userName ? userName.charAt(0).toUpperCase() : '?'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.footerInfo}>
            <Text style={styles.footerUserName} numberOfLines={1}>
              {userName}
            </Text>
            {responseLabel ? (
              <Text style={styles.footerResponseTime}>{responseLabel}</Text>
            ) : null}
          </View>
        </View>

        {/* Branding / watermark */}
        <View style={styles.brandRow}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>Join us on Blink</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: theme.bg,
  },

  /* ── Header ───────────────────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 48,
    paddingTop: 72,
    paddingBottom: 32,
  },
  logoText: {
    fontSize: 52,
    fontWeight: '800',
    color: theme.coral,
    letterSpacing: -1,
  },
  groupPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bgCardSolid,
    borderRadius: 40,
    paddingHorizontal: 28,
    paddingVertical: 14,
    gap: 10,
    maxWidth: 500,
    borderWidth: 1,
    borderColor: theme.border,
  },
  groupEmoji: {
    fontSize: 28,
  },
  groupName: {
    fontSize: 26,
    fontWeight: '600',
    color: theme.text,
  },

  /* ── Photo ────────────────────────────────────────────── */
  photoWrapper: {
    flex: 1,
    marginHorizontal: 32,
    borderRadius: 32,
    overflow: 'hidden',
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  promptOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 40,
    paddingBottom: 44,
    paddingTop: 120,
  },
  promptText: {
    fontSize: 38,
    fontWeight: '700',
    color: theme.white,
    lineHeight: 50,
    letterSpacing: -0.3,
  },

  /* ── Footer ───────────────────────────────────────────── */
  footer: {
    paddingHorizontal: 48,
    paddingTop: 32,
    paddingBottom: 64,
    gap: 24,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  avatarContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: theme.coral,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 30,
    fontWeight: '700',
    color: theme.white,
  },
  footerInfo: {
    flex: 1,
    gap: 4,
  },
  footerUserName: {
    fontSize: 30,
    fontWeight: '700',
    color: theme.text,
  },
  footerResponseTime: {
    fontSize: 22,
    fontWeight: '500',
    color: theme.textSecondary,
  },

  /* ── Branding watermark ───────────────────────────────── */
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.coral,
  },
  brandText: {
    fontSize: 22,
    fontWeight: '600',
    color: theme.textMuted,
    letterSpacing: 0.5,
  },
});
