import React from 'react';
import { ApiChallenge } from '@/types/api';
import { SnapCardSkeleton, EmptyState, ErrorState } from '@/components/ui';
import SnapCard from '@/components/SnapCard';
import BlurredPreviewCard from '@/components/BlurredPreviewCard';
import type { ProgressData } from './ChallengeSection';

interface SnapItem {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  groupId: string;
  imageUrl: string;
  timestamp: string;
  reactions: { emoji: string; count: number; userIds: string[] }[];
}

export interface ChallengeResponsesListProps {
  activeChallenge: ApiChallenge | null;
  /** Show the blurred "respond to see" teaser when the user hasn't answered. */
  showTeaser: boolean;
  responsesLoading: boolean;
  responsesError: boolean;
  onRetryResponses: () => void;
  hasSubmittedToday: boolean;
  currentUserId: string;
  snaps: SnapItem[];
  groupPhotosCount: number;
  groupMemberCount: number;
  previewData: {
    respondedCount: number;
    totalMembers: number;
    totalReactions: number;
    topReactionEmoji?: string;
    respondedUsers: { displayName: string }[];
  } | null;
  progressData: ProgressData | null;
  challengeJustTriggered?: boolean;
  onRespond: () => void;
  onReact: (snapId: string, emoji: string) => void;
  onReport: (snapId: string, userId: string) => void;
  onBlock: (userId: string, userName: string) => void;
}

export default function ChallengeResponsesList({
  activeChallenge,
  showTeaser,
  responsesLoading,
  responsesError,
  onRetryResponses,
  hasSubmittedToday,
  currentUserId,
  snaps,
  groupPhotosCount,
  groupMemberCount,
  previewData,
  progressData,
  challengeJustTriggered,
  onRespond,
  onReact,
  onReport,
  onBlock,
}: ChallengeResponsesListProps) {
  return (
    <>
      {/* Blurred preview if user hasn't responded */}
      {showTeaser && !hasSubmittedToday && activeChallenge && (previewData || snaps.length > 0) && (
        <BlurredPreviewCard
          respondedCount={previewData?.respondedCount ?? snaps.length}
          totalMembers={previewData?.totalMembers ?? groupMemberCount}
          totalReactions={previewData?.totalReactions ?? 0}
          topReactionEmoji={previewData?.topReactionEmoji}
          respondedUsers={
            previewData?.respondedUsers ?? snaps.map((sn) => ({ displayName: sn.userName, avatarUrl: sn.userAvatar }))
          }
          challengeJustStarted={challengeJustTriggered}
          onRespond={onRespond}
          activityPulseProps={
            progressData
              ? {
                  respondedUsers: progressData.responded,
                  totalMembers: progressData.totalMembers,
                  currentUserId,
                  hasResponded: false,
                  challengeJustStarted: challengeJustTriggered,
                }
              : undefined
          }
        />
      )}

      {/* Loading / Error / Snap Cards */}
      {responsesLoading && activeChallenge ? (
        <>
          <SnapCardSkeleton />
          <SnapCardSkeleton />
        </>
      ) : responsesError ? (
        <ErrorState message="Failed to load snaps" onRetry={onRetryResponses} compact />
      ) : hasSubmittedToday && snaps.length > 0 ? (
        snaps.map((snap) => (
          <SnapCard
            key={snap.id}
            snap={snap}
            isLocked={false}
            currentUserId={currentUserId}
            onReact={onReact}
            onReport={onReport}
            onBlock={onBlock}
          />
        ))
      ) : snaps.length === 0 && !activeChallenge && groupPhotosCount === 0 ? (
        <EmptyState emoji={'\u{1F4F8}'} title="No snaps yet" subtitle="Start a challenge to see snaps here!" />
      ) : null}
    </>
  );
}
