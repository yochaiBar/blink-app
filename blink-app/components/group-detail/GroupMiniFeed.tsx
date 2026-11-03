import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from '@/services/api';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing } from '@/constants/spacing';
import { getRelativeTime } from '@/utils/time';
import FeedItem, { FeedItemData } from '@/components/FeedItem';
import { ApiChallengeResponse } from '@/types/api';

interface ChallengeHistoryItem {
  id: string;
  group_id: string;
  prompt: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  status: string;
  response_count: number;
  member_count: number;
  user_responded: boolean;
}

interface Props {
  groupId: string;
  groupName: string;
  groupEmoji: string;
}

export default function GroupMiniFeed({ groupId, groupName, groupEmoji }: Props) {
  const router = useRouter();

  const feedQuery = useQuery({
    queryKey: ['group-mini-feed', groupId],
    queryFn: async (): Promise<FeedItemData[]> => {
      const items: FeedItemData[] = [];

      const history: ChallengeHistoryItem[] = await api(`/challenges/groups/${groupId}/challenges/history?limit=10`);
      if (!Array.isArray(history)) return [];

      const challengeFetches = history.map(async (challenge) => {
        if (!challenge.user_responded) return; // Skip unresponded in mini-feed too

        try {
          const responses: ApiChallengeResponse[] = await api(`/challenges/${challenge.id}/responses`);
          if (!Array.isArray(responses) || responses.length === 0) return;

          for (const resp of responses) {
            if (resp.photo_url) {
              items.push({
                id: `mini_photo_${resp.id}`,
                type: 'photo',
                userName: resp.display_name || 'User',
                userAvatar: resp.avatar_url || undefined,
                groupName,
                groupEmoji,
                groupId,
                challengeId: challenge.id,
                photoUrl: resp.photo_url,
                challengePrompt: challenge.prompt || undefined,
                timeAgo: getRelativeTime(resp.responded_at || resp.created_at),
                timestamp: resp.responded_at || resp.created_at,
                reactions: [],
              });
            }
          }
        } catch {
          // Non-critical: responses fetch failed
        }
      });

      await Promise.all(challengeFetches);
      return items;
    },
    enabled: !!groupId,
    staleTime: 30_000,
  });

  const sortedItems = useMemo(() => {
    const items = feedQuery.data ?? [];
    return [...items].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });
  }, [feedQuery.data]);

  const handleItemPress = (item: FeedItemData) => {
    if (item.challengeId) {
      router.push({
        pathname: '/challenge-reveal' as never,
        params: { challengeId: item.challengeId, groupId },
      });
    }
  };

  if (sortedItems.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Recent Activity</Text>
      {sortedItems.map((item) => (
        <FeedItem key={item.id} item={{ ...item, onPress: () => handleItemPress(item) }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.lg,
  },
  sectionTitle: {
    ...typography.headlineMedium,
    color: theme.text,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
});
