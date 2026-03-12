import React from 'react';
import { ApiChallenge, ApiChallengeResponse } from '@/types/api';
import { SnapCardSkeleton, EmptyState, ErrorState } from '@/components/ui';
import SnapCard from '@/components/SnapCard';
import SpotlightCard from '@/components/SpotlightCard';
import BlurredPreviewCard from '@/components/BlurredPreviewCard';
import AiCommentaryCard from '@/components/AiCommentaryCard';
import QuizResultsSection from './QuizResultsSection';
import type { QuizDistributionItem } from './QuizResultsSection';
import type { ProgressData } from './ChallengeSection';
import { DailySpotlight } from '@/types';

interface SnapItem {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  groupId: string;
  imageUrl: string;
  timestamp: string;
  reactions: Array<{ emoji: string; count: number; userIds: string[] }>;
}

export interface ChallengeResponsesListProps {
  activeChallenge: ApiChallenge | null;
  isDemo: boolean;
  responsesLoading: boolean;
  responsesError: boolean;
  responsesData: ApiChallengeResponse[] | undefined;
  onRetryResponses: () => void;
  isQuizChallenge: boolean;
  hasSubmittedToday: boolean;
  quizDistribution: QuizDistributionItem[];
  currentUserId: string;
  snaps: SnapItem[];
  groupPhotosCount: number;
  groupMemberCount: number;
  spotlight: DailySpotlight | null;
  previewData: {
    respondedCount: number;
    totalMembers: number;
    totalReactions: number;
    topReactionEmoji?: string;
    respondedUsers: Array<{ displayName: string; avatarUrl?: string }>;
  } | null;
  progressData: ProgressData | null;
  aiCommentary: { challengeId: string; commentary: string } | null;
  onRespond: () => void;
  onReact: (snapId: string, emoji: string) => void;
  onReport: (snapId: string, userId: string) => void;
  onBlock: (userId: string, userName: string) => void;
}

export default function ChallengeResponsesList({
  activeChallenge,
  isDemo,
  responsesLoading,
  responsesError,
  responsesData,
  onRetryResponses,
  isQuizChallenge,
  hasSubmittedToday,
  quizDistribution,
  currentUserId,
  snaps,
  groupPhotosCount,
  groupMemberCount,
  spotlight,
  previewData,
  progressData,
  aiCommentary,
  onRespond,
  onReact,
  onReport,
  onBlock,
}: ChallengeResponsesListProps) {
  const myResponse = (responsesData ?? []).find((r) => r.user_id === currentUserId);

  return (
    <>
      {/* Daily Spotlight */}
      {spotlight && !isDemo && (
        <SpotlightCard spotlight={spotlight} />
      )}

      {/* Blurred preview if user hasn't responded */}
      {!hasSubmittedToday && activeChallenge && !isDemo && (previewData || snaps.length > 0) && (
        <BlurredPreviewCard
          respondedCount={previewData?.respondedCount ?? snaps.length}
          totalMembers={previewData?.totalMembers ?? groupMemberCount}
          totalReactions={previewData?.totalReactions ?? 0}
          topReactionEmoji={previewData?.topReactionEmoji}
          respondedUsers={
            previewData?.respondedUsers ??
            snaps.map((sn) => ({ displayName: sn.userName, avatarUrl: sn.userAvatar }))
          }
          onRespond={onRespond}
          activityPulseProps={
            progressData
              ? {
                  respondedUsers: progressData.responded,
                  totalMembers: progressData.totalMembers,
                  currentUserId,
                  hasResponded: false,
                }
              : undefined
          }
        />
      )}

      {/* Loading / Error / Quiz Results / Snap Cards */}
      {responsesLoading && activeChallenge ? (
        <>
          <SnapCardSkeleton />
          <SnapCardSkeleton />
        </>
      ) : responsesError ? (
        <ErrorState
          message="Failed to load snaps"
          onRetry={onRetryResponses}
          compact
        />
      ) : isQuizChallenge && activeChallenge ? (
        hasSubmittedToday && quizDistribution.length > 0 ? (
          <QuizResultsSection
            promptText={activeChallenge.prompt_text ?? activeChallenge.prompt ?? 'Quiz'}
            totalResponses={(responsesData ?? []).length}
            distribution={quizDistribution}
            currentUserId={currentUserId}
            myAnswerIndex={myResponse?.answer_index}
          />
        ) : !hasSubmittedToday ? (
          <EmptyState
            emoji={"\u{1F9E0}"}
            title="Quiz active!"
            subtitle="Tap the challenge bar to answer"
          />
        ) : (
          <EmptyState
            emoji={"\u23F3"}
            title="Waiting for responses"
            subtitle="Results appear when others answer"
          />
        )
      ) : hasSubmittedToday && snaps.length > 0 ? (
        snaps.map(snap => (
          <SnapCard
            key={snap.id}
            snap={snap}
            isLocked={false}
            onReact={onReact}
            onReport={onReport}
            onBlock={onBlock}
          />
        ))
      ) : snaps.length === 0 && !activeChallenge && groupPhotosCount === 0 ? (
        <EmptyState
          emoji={"\u{1F4F8}"}
          title="No snaps yet"
          subtitle="Start a challenge to see snaps here!"
        />
      ) : snaps.length > 0 && !hasSubmittedToday ? (
        null
      ) : null}

      {/* AI Commentary Card */}
      {aiCommentary && (
        <AiCommentaryCard commentary={aiCommentary.commentary} />
      )}
    </>
  );
}
