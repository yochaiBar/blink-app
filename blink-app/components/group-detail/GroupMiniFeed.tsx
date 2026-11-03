import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { fetchGroupChallenges, shouldBlurOthers } from '@/services/challengeReads';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing } from '@/constants/spacing';
import { getRelativeTime } from '@/utils/time';
import FeedItem, { FeedItemData } from '@/components/FeedItem';

interface Props {
  groupId: string;
  groupName: string;
  groupEmoji: string;
}

export default function GroupMiniFeed({ groupId, groupName, groupEmoji }: Props) {
  const router = useRouter();

  // Photos from challenges you answered, and from closed ones; an open
  // challenge you haven't answered keeps its photos hidden until you do.
  const feedQuery = useQuery({
    queryKey: ['group-mini-feed', groupId],
    queryFn: async (): Promise<FeedItemData[]> => {
      const challenges = await fetchGroupChallenges(groupId, 10);
      return challenges
        .filter((challenge) => !shouldBlurOthers(challenge))
        .flatMap((challenge) =>
          challenge.responses
            .filter((resp) => resp.has_photo)
            .map((resp) => ({
              id: `mini_photo_${resp.id}`,
              type: 'photo' as const,
              responseId: resp.id,
              userName: resp.display_name || 'User',
              groupName,
              groupEmoji,
              groupId,
              challengeId: challenge.id,
              challengePrompt: challenge.prompt || undefined,
              timeAgo: getRelativeTime(resp.responded_at),
              timestamp: resp.responded_at,
              reactions: resp.reactions ?? [],
            })),
        );
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
        pathname: '/challenge-reveal',
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
