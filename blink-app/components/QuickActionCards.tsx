import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated } from 'react-native';
import { UserPlus, Plus, Search } from 'lucide-react-native';
import { theme } from '@/constants/colors';

interface QuickActionCardsProps {
  onInviteFriends: () => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
}

const CARDS = [
  { key: 'invite', title: 'Invite Friends', subtitle: 'Grow your crew', bg: theme.blueMuted, iconColor: theme.blue, Icon: UserPlus },
  { key: 'create', title: 'Create Group', subtitle: 'Start something new', bg: theme.greenMuted, iconColor: theme.green, Icon: Plus },
  { key: 'join', title: 'Join Group', subtitle: 'Find your friends', bg: theme.purpleMuted, iconColor: theme.purple, Icon: Search },
] as const;

export default React.memo(function QuickActionCards({ onInviteFriends, onCreateGroup, onJoinGroup }: QuickActionCardsProps) {
  const handlers = [onInviteFriends, onCreateGroup, onJoinGroup];
  const anims = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

  useEffect(() => {
    const animations = anims.map((a, i) =>
      Animated.timing(a, { toValue: 1, duration: 350, delay: i * 100, useNativeDriver: true })
    );
    Animated.stagger(100, animations).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
    >
      {CARDS.map((card, i) => (
        <Animated.View key={card.key} style={{ opacity: anims[i], transform: [{ translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
          <TouchableOpacity style={[styles.card, { backgroundColor: card.bg }]} onPress={handlers[i]} activeOpacity={0.85}>
            <View style={styles.iconWrap}>
              <card.Icon size={22} color={card.iconColor} />
            </View>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.cardSub}>{card.subtitle}</Text>
          </TouchableOpacity>
        </Animated.View>
      ))}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scroll: { paddingBottom: 4 },
  card: {
    width: 130,
    height: 140,
    borderRadius: 16,
    padding: 14,
    marginRight: 12,
    justifyContent: 'space-between',
  },
  iconWrap: { marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: theme.text },
  cardSub: { fontSize: 11, color: theme.textSecondary, marginTop: 2 },
});
