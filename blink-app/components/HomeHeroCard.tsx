import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Image } from 'expo-image';
import { Sparkles, Star } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '@/constants/colors';
import { Group, UserProfile } from '@/types';

type HeroMode = 'welcome' | 'challenge' | 'summary';

interface HomeHeroCardProps {
  mode: HeroMode;
  user: UserProfile;
  activeGroup?: Group;
  groupCount: number;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  onRespondChallenge?: () => void;
}

export default React.memo(function HomeHeroCard({
  mode,
  user,
  activeGroup,
  groupCount,
  onCreateGroup,
  onJoinGroup,
  onRespondChallenge,
}: HomeHeroCardProps) {
  if (mode === 'welcome') return <WelcomeCard onCreateGroup={onCreateGroup} onJoinGroup={onJoinGroup} />;
  if (mode === 'challenge' && activeGroup) return <ChallengeCard group={activeGroup} onRespond={onRespondChallenge} />;
  return <SummaryCard user={user} groupCount={groupCount} />;
});

/* ─── Welcome Card ─── */

function WelcomeCard({ onCreateGroup, onJoinGroup }: { onCreateGroup: () => void; onJoinGroup: () => void }) {
  return (
    <LinearGradient
      colors={['#FF6B4A18', '#A78BFA18', '#151520'] as const}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.headerRow}>
        <Sparkles size={20} color={theme.coral} />
        <Text style={styles.welcomeTitle}>Welcome to Blink!</Text>
      </View>
      <Text style={styles.welcomeSub}>
        Create or join a group to start snapping with friends
      </Text>
      <View style={styles.btnRow}>
        <TouchableOpacity style={styles.btnFilled} onPress={onCreateGroup} activeOpacity={0.85}>
          <Text style={styles.btnFilledText}>Create Group</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnOutlined} onPress={onJoinGroup} activeOpacity={0.85}>
          <Text style={styles.btnOutlinedText}>Join Group</Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

/* ─── Challenge Card ─── */

function ChallengeCard({ group, onRespond }: { group: Group; onRespond?: () => void }) {
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(1)).current;
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.4, duration: 750, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1, duration: 750, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 0.4, duration: 750, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 1, duration: 750, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, [pulseScale, pulseOpacity]);

  const updateCountdown = useCallback(() => {
    const remaining = Math.max(0, (group.challengeEndTime ?? 0) - Date.now());
    if (remaining <= 0) { setCountdown('0:00'); return; }
    const hrs = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    setCountdown(
      hrs > 0
        ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        : `${mins}:${secs.toString().padStart(2, '0')}`
    );
  }, [group.challengeEndTime]);

  useEffect(() => {
    updateCountdown();
    const id = setInterval(updateCountdown, 1000);
    return () => clearInterval(id);
  }, [updateCountdown]);

  const displayedMembers = group.members.slice(0, 4);

  return (
    <View style={styles.challengeOuter}>
      <View style={styles.challengeCard}>
        {/* LIVE badge */}
        <View style={styles.liveRow}>
          <Animated.View style={[styles.liveDot, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
          <Text style={styles.liveLabel}>LIVE CHALLENGE</Text>
        </View>

        {/* Group info */}
        <View style={styles.groupRow}>
          <Text style={styles.groupEmoji}>{group.emoji}</Text>
          <Text style={styles.groupName}>{group.name}</Text>
        </View>

        {/* Countdown */}
        <Text style={styles.countdown}>{countdown}</Text>

        {/* Avatar stack */}
        <View style={styles.avatarStack}>
          {displayedMembers.map((m, i) => (
            <View key={m.id} style={[styles.avatarWrap, { marginLeft: i > 0 ? -10 : 0, zIndex: displayedMembers.length - i }]}>
              <Image source={{ uri: m.avatar }} style={styles.avatar} contentFit="cover" />
            </View>
          ))}
          {group.members.length > 4 && (
            <View style={[styles.avatarWrap, styles.extraBadge, { marginLeft: -10 }]}>
              <Text style={styles.extraText}>+{group.members.length - 4}</Text>
            </View>
          )}
        </View>

        {/* CTA */}
        <TouchableOpacity style={styles.ctaBtn} onPress={onRespond} activeOpacity={0.85}>
          <Text style={styles.ctaBtnText}>Tap to respond</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ─── Summary Card ─── */

function SummaryCard({ user, groupCount }: { user: UserProfile; groupCount: number }) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    ).start();
  }, [shimmerAnim]);

  const glowOpacity = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] });

  return (
    <LinearGradient
      colors={['#FFD84D22', '#FF6B4A22', '#A78BFA22'] as const}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, { borderWidth: 1, borderColor: 'rgba(255, 216, 77, 0.2)' }]}
    >
      <View style={styles.headerRow}>
        <Animated.View style={{ opacity: glowOpacity }}>
          <Star size={16} color={theme.yellow} fill={theme.yellow} />
        </Animated.View>
        <Text style={styles.starTitle}>TODAY'S STAR</Text>
      </View>

      <View style={styles.profileRow}>
        <View style={styles.avatarRing}>
          <Image source={{ uri: user.avatar }} style={styles.ringAvatar} contentFit="cover" />
        </View>
        <Text style={styles.profileName}>
          {user.totalSnaps > 0 ? user.name.split(' ')[0] : 'Be the first to snap!'}
        </Text>
      </View>

      <View style={styles.pillRow}>
        <View style={styles.pill}>
          <Text style={styles.pillValue}>{user.totalSnaps}</Text>
          <Text style={styles.pillLabel}>Snaps</Text>
        </View>
        <View style={styles.pill}>
          <Text style={styles.pillValue}>{user.longestStreak}</Text>
          <Text style={styles.pillLabel}>Streak</Text>
        </View>
        <View style={styles.pill}>
          <Text style={styles.pillValue}>{groupCount}</Text>
          <Text style={styles.pillLabel}>Groups</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
  },

  /* Welcome */
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  welcomeTitle: { fontSize: 20, fontWeight: '800' as const, color: theme.text },
  welcomeSub: { fontSize: 14, color: theme.textSecondary, lineHeight: 20, marginBottom: 18 },
  btnRow: { flexDirection: 'row', gap: 12 },
  btnFilled: {
    flex: 1,
    backgroundColor: theme.coral,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnFilledText: { fontSize: 15, fontWeight: '700' as const, color: theme.white },
  btnOutlined: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: theme.coral,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnOutlinedText: { fontSize: 15, fontWeight: '700' as const, color: theme.coral },

  /* Challenge */
  challengeOuter: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#FF6B4A40',
    marginBottom: 16,
    overflow: 'hidden',
  },
  challengeCard: {
    backgroundColor: theme.bgCard,
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.coral },
  liveLabel: { fontSize: 12, fontWeight: '800' as const, color: theme.coral, letterSpacing: 1 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  groupEmoji: { fontSize: 22 },
  groupName: { fontSize: 17, fontWeight: '700' as const, color: theme.text },
  countdown: {
    fontSize: 28,
    fontWeight: '900' as const,
    color: theme.coral,
    fontVariant: ['tabular-nums'],
    marginBottom: 14,
  },
  avatarStack: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatarWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: theme.bgCard,
    overflow: 'hidden',
  },
  avatar: { width: '100%', height: '100%', borderRadius: 16 },
  extraBadge: { backgroundColor: theme.surfaceLight, justifyContent: 'center', alignItems: 'center' },
  extraText: { fontSize: 10, fontWeight: '700' as const, color: theme.textSecondary },
  ctaBtn: {
    backgroundColor: theme.coral,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  ctaBtnText: { fontSize: 15, fontWeight: '700' as const, color: theme.white },

  /* Summary */
  starTitle: { fontSize: 14, fontWeight: '700' as const, color: theme.yellow, letterSpacing: 0.5, textTransform: 'uppercase' },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  avatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: theme.yellow,
    padding: 2,
  },
  ringAvatar: { width: '100%', height: '100%', borderRadius: 24 },
  profileName: { fontSize: 18, fontWeight: '700' as const, color: theme.text },
  pillRow: { flexDirection: 'row', justifyContent: 'space-around' },
  pill: { alignItems: 'center', gap: 2 },
  pillValue: { fontSize: 16, fontWeight: '800' as const, color: theme.text },
  pillLabel: { fontSize: 11, color: theme.textMuted },
});
