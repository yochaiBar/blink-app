import React, { useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Trophy, Flame } from 'lucide-react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import { LeaderboardEntry } from '@/types';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '@/services/api';
import { ApiGroupDetail } from '@/types/api';
import { apiMembersToLeaderboard } from '@/utils/adapters';
import { Skeleton, EmptyState, ErrorState } from '@/components/ui';

const rankColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
const rankEmojis = ['🥇', '🥈', '🥉'];

export default function GroupLeaderboardScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { groups, user } = useApp();

  const group = groups.find(g => g.id === groupId);

  // Fetch group detail for member stats
  const detailQuery = useQuery({
    queryKey: ['group', groupId],
    queryFn: async () => {
      const detail: ApiGroupDetail = await api(`/groups/${groupId}`);
      return detail;
    },
    enabled: !!groupId,
    staleTime: 15_000,
  });

  const leaderboard = detailQuery.data
    ? apiMembersToLeaderboard(detailQuery.data.members)
    : [];

  const topThree = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);

  const renderPodiumItem = useCallback((entry: LeaderboardEntry, position: number) => {
    const isFirst = position === 0;
    return (
      <View style={[styles.podiumItem, isFirst && styles.podiumItemFirst]} key={entry.userId}>
        <View style={styles.podiumRankBadge}>
          <Text style={styles.podiumRankEmoji}>{rankEmojis[position]}</Text>
        </View>
        <View style={[styles.podiumAvatarRing, { borderColor: rankColors[position] }]}>
          <Image source={{ uri: entry.userAvatar }} style={styles.podiumAvatar} contentFit="cover" />
        </View>
        <Text style={styles.podiumName} numberOfLines={1}>{entry.userName}</Text>
        <Text style={[styles.podiumScore, { color: rankColors[position] }]}>{entry.score}</Text>
        <View style={styles.podiumStreakRow}>
          <Flame size={12} color={theme.yellow} />
          <Text style={styles.podiumStreak}>{entry.streak}</Text>
        </View>
      </View>
    );
  }, []);

  const renderListItem = useCallback(({ item }: { item: LeaderboardEntry }) => {
    const isMe = item.userId === user.id;
    return (
      <View style={[styles.listItem, isMe && styles.listItemMe]}>
        <Text style={styles.listRank}>#{item.rank}</Text>
        <Image source={{ uri: item.userAvatar }} style={styles.listAvatar} contentFit="cover" />
        <View style={styles.listInfo}>
          <Text style={[styles.listName, isMe && { color: theme.coral }]}>
            {item.userName} {isMe ? '(you)' : ''}
          </Text>
          <View style={styles.listStreakRow}>
            <Flame size={12} color={theme.yellow} />
            <Text style={styles.listStreakText}>{item.streak} day streak</Text>
          </View>
        </View>
        <Text style={styles.listScore}>{item.score}</Text>
      </View>
    );
  }, [user.id]);

  if (!group) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Trophy size={18} color={theme.yellow} />
            <Text style={styles.headerTitle}>Leaderboard</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <ErrorState message="Group not found" />
      </View>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Trophy size={18} color={theme.yellow} />
            <Text style={styles.headerTitle}>Leaderboard</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ paddingHorizontal: 16, gap: 8, paddingTop: 20 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.skeletonRow}>
              <Skeleton variant="text" width={28} height={15} />
              <Skeleton variant="circle" width={40} height={40} />
              <View style={styles.skeletonInfo}>
                <Skeleton variant="text" width={100} height={14} />
                <Skeleton variant="text" width={60} height={12} />
              </View>
              <Skeleton variant="text" width={30} height={18} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (detailQuery.isError) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={theme.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Trophy size={18} color={theme.yellow} />
            <Text style={styles.headerTitle}>Leaderboard</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <ErrorState
          message="Failed to load leaderboard"
          onRetry={() => detailQuery.refetch()}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Trophy size={18} color={theme.yellow} />
          <Text style={styles.headerTitle}>Leaderboard</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.groupHeader}>
        <Text style={styles.groupEmoji}>{group.emoji}</Text>
        <Text style={styles.groupName}>{group.name}</Text>
      </View>

      {leaderboard.length === 0 ? (
        <EmptyState
          emoji="🏆"
          title="No rankings yet"
          subtitle="Start participating to climb the leaderboard!"
        />
      ) : topThree.length >= 3 ? (
        <>
          <LinearGradient
            colors={['rgba(255, 215, 0, 0.06)', 'transparent']}
            style={styles.podium}
          >
            <View style={styles.podiumRow}>
              {renderPodiumItem(topThree[1], 1)}
              {renderPodiumItem(topThree[0], 0)}
              {renderPodiumItem(topThree[2], 2)}
            </View>
          </LinearGradient>

          <FlatList
            data={rest}
            renderItem={renderListItem}
            keyExtractor={(item) => item.userId}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={detailQuery.isRefetching}
                onRefresh={() => detailQuery.refetch()}
                tintColor={theme.coral}
              />
            }
          />
        </>
      ) : (
        <FlatList
          data={leaderboard}
          renderItem={renderListItem}
          keyExtractor={(item) => item.userId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={detailQuery.isRefetching}
              onRefresh={() => detailQuery.refetch()}
              tintColor={theme.coral}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  errorText: {
    fontSize: 16,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: theme.text,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 12,
  },
  groupEmoji: {
    fontSize: 20,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: theme.textSecondary,
  },
  podium: {
    paddingVertical: 20,
    marginHorizontal: 16,
    borderRadius: 20,
    marginBottom: 8,
  },
  podiumRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 12,
  },
  podiumItem: {
    alignItems: 'center',
    width: 90,
    gap: 6,
  },
  podiumItemFirst: {
    marginBottom: 16,
  },
  podiumRankBadge: {
    marginBottom: 4,
  },
  podiumRankEmoji: {
    fontSize: 24,
  },
  podiumAvatarRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
    padding: 2,
  },
  podiumAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
  },
  podiumName: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: theme.text,
    textAlign: 'center',
  },
  podiumScore: {
    fontSize: 20,
    fontWeight: '900' as const,
  },
  podiumStreakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  podiumStreak: {
    fontSize: 12,
    color: theme.textMuted,
    fontWeight: '600' as const,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 6,
    backgroundColor: theme.bgCard,
  },
  listItemMe: {
    borderWidth: 1,
    borderColor: `${theme.coral}40`,
    backgroundColor: `${theme.coral}08`,
  },
  listRank: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: theme.textMuted,
    width: 28,
  },
  listAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  listInfo: {
    flex: 1,
    gap: 3,
  },
  listName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: theme.text,
  },
  listStreakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  listStreakText: {
    fontSize: 12,
    color: theme.textMuted,
  },
  listScore: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: theme.text,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 6,
    backgroundColor: theme.bgCard,
  },
  skeletonInfo: {
    flex: 1,
    gap: 4,
  },
});
