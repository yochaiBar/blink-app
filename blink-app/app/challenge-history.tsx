import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Check, X as XIcon } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { api } from '@/services/api';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { getRelativeTime } from '@/utils/time';

interface ChallengeHistoryItem {
  id: string;
  group_id: string;
  type: string;
  prompt: string | null;
  options: string[] | null;
  created_at: string;
  expires_at: string;
  response_count: number;
  member_count: number;
  user_responded: boolean;
}

const typeConfig: Record<string, { emoji: string; label: string }> = {
  snap: { emoji: '\uD83D\uDCF8', label: 'Snap Challenge' },
  food_quiz: { emoji: '\uD83C\uDF54', label: 'Food Quiz' },
  most_likely: { emoji: '\uD83D\uDC40', label: 'Most Likely To' },
  rate_day: { emoji: '\u2B50', label: 'Rate Your Day' },
};

function getTypeConfig(type: string): { emoji: string; label: string } {
  if (typeConfig[type]) return typeConfig[type];
  if (type.includes('quiz') || type.includes('food')) return typeConfig['food_quiz'];
  if (type.includes('most_likely')) return typeConfig['most_likely'];
  if (type.includes('rate') || type.includes('day')) return typeConfig['rate_day'];
  return { emoji: '\uD83D\uDCF8', label: 'Challenge' };
}

function HistoryItemSkeleton() {
  return (
    <View style={styles.historyCard}>
      <View style={styles.historyLeft}>
        <Skeleton variant="circle" width={40} height={40} borderRadius={12} />
      </View>
      <View style={styles.historyContent}>
        <Skeleton variant="text" width={160} height={16} />
        <Skeleton variant="text" width={100} height={12} />
        <Skeleton variant="text" width={80} height={12} />
      </View>
    </View>
  );
}

export default function ChallengeHistoryScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const historyQuery = useQuery({
    queryKey: ['challenge-history', groupId],
    queryFn: async (): Promise<ChallengeHistoryItem[]> => {
      const data = await api(`/challenges/groups/${groupId}/challenges/history`);
      return data as ChallengeHistoryItem[];
    },
    enabled: !!groupId,
    staleTime: 30_000,
  });

  const handleChallengePress = useCallback((item: ChallengeHistoryItem) => {
    if (item.type === 'snap') {
      // Navigate to group detail to see snap responses
      router.push({ pathname: '/group-detail' as never, params: { id: item.group_id } });
    } else {
      // Navigate to quiz-challenge in results mode
      router.push({
        pathname: '/quiz-challenge' as never,
        params: {
          groupId: item.group_id,
          challengeId: item.id,
          type: item.type,
          promptText: item.prompt ?? '',
          optionsJson: JSON.stringify(item.options ?? []),
          expiresAt: item.expires_at,
        },
      });
    }
  }, [router]);

  const renderItem = useCallback(({ item }: { item: ChallengeHistoryItem }) => {
    const config = getTypeConfig(item.type);
    const respondedRatio = item.member_count > 0
      ? `${item.response_count}/${item.member_count} responded`
      : `${item.response_count} responded`;

    return (
      <TouchableOpacity
        style={styles.historyCard}
        onPress={() => handleChallengePress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.historyLeft}>
          <View style={styles.typeIconCircle}>
            <Text style={styles.typeEmoji}>{config.emoji}</Text>
          </View>
        </View>

        <View style={styles.historyContent}>
          <Text style={styles.promptText} numberOfLines={2}>
            {item.prompt ?? config.label}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.responseCount}>{respondedRatio}</Text>
            <Text style={styles.metaDot}>{'\u00B7'}</Text>
            <Text style={styles.timestamp}>{getRelativeTime(item.created_at)}</Text>
          </View>
        </View>

        <View style={styles.historyRight}>
          {item.user_responded ? (
            <View style={styles.statusBadgeGreen}>
              <Check size={12} color={theme.green} />
            </View>
          ) : (
            <View style={styles.statusBadgeRed}>
              <XIcon size={12} color={theme.textMuted} />
              <Text style={styles.missedText}>missed</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }, [handleChallengePress]);

  const renderLoadingState = () => (
    <View style={styles.loadingContainer}>
      {[0, 1, 2, 3, 4].map(i => (
        <HistoryItemSkeleton key={i} />
      ))}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Challenge History</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Loading state */}
      {historyQuery.isLoading && renderLoadingState()}

      {/* Error state */}
      {historyQuery.isError && !historyQuery.isLoading && (
        <ErrorState
          message="Could not load challenge history"
          onRetry={() => historyQuery.refetch()}
        />
      )}

      {/* Data */}
      {!historyQuery.isLoading && !historyQuery.isError && (
        <FlatList
          data={historyQuery.data ?? []}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={historyQuery.isRefetching}
              onRefresh={() => historyQuery.refetch()}
              tintColor={theme.coral}
            />
          }
          ListEmptyComponent={
            <EmptyState
              emoji={'\uD83D\uDCDA'}
              title="No challenge history"
              subtitle="Completed challenges will appear here"
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
  headerTitle: {
    ...typography.h3,
    color: theme.text,
  },
  loadingContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
  },
  historyLeft: {},
  typeIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeEmoji: {
    fontSize: 20,
  },
  historyContent: {
    flex: 1,
    gap: 4,
  },
  promptText: {
    ...typography.bodyBold,
    color: theme.text,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  responseCount: {
    ...typography.caption,
    color: theme.textSecondary,
  },
  metaDot: {
    ...typography.caption,
    color: theme.textMuted,
  },
  timestamp: {
    ...typography.caption,
    color: theme.textMuted,
  },
  historyRight: {
    alignItems: 'center',
  },
  statusBadgeGreen: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.greenMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusBadgeRed: {
    alignItems: 'center',
    gap: 2,
  },
  missedText: {
    ...typography.small,
    color: theme.textMuted,
  },
});
