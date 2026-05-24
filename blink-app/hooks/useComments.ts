import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CommentItem,
  deleteComment as deleteCommentApi,
  fetchComments,
  postComment,
} from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { queryKeys } from '@/utils/queryKeys';

interface UseCommentsResult {
  comments: CommentItem[];
  isLoading: boolean;
  refetch: () => void;
  post: (text: string, parentCommentId?: string) => Promise<void>;
  remove: (commentId: string) => Promise<void>;
  isPosting: boolean;
}

/**
 * Fetches and mutates the comment thread for a single photo response.
 *
 * Optimistic insert on post: a temporary client-side comment shows up
 * immediately, then is replaced (or rolled back on error) when the server
 * responds. Same pattern for delete.
 *
 * Socket invalidation lives in `useSocket` — server-emitted `comment:created`
 * and `comment:deleted` events invalidate this query for any client viewing
 * the same response.
 */
export function useComments(responseId: string | undefined): UseCommentsResult {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const key = responseId ? queryKeys.comments.forResponse(responseId) : ['comments', 'disabled'];

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchComments(responseId!),
    enabled: !!responseId,
    staleTime: 30_000,
  });

  const postMutation = useMutation({
    mutationFn: ({ text, parentCommentId }: { text: string; parentCommentId?: string }) =>
      postComment(responseId!, text, parentCommentId),
    onMutate: async ({ text, parentCommentId }) => {
      if (!responseId) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CommentItem[]>(key);
      const optimistic: CommentItem = {
        id: `optimistic-${Date.now()}`,
        response_id: responseId,
        user_id: user?.id ?? 'me',
        parent_comment_id: parentCommentId ?? null,
        text,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        display_name: user?.display_name ?? 'You',
        avatar_url: user?.avatar_url ?? null,
      };
      queryClient.setQueryData<CommentItem[]>(key, (old) => [...(old ?? []), optimistic]);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => deleteCommentApi(commentId),
    onMutate: async (commentId) => {
      if (!responseId) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CommentItem[]>(key);
      queryClient.setQueryData<CommentItem[]>(key, (old) =>
        (old ?? []).filter((c) => c.id !== commentId),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const post = useCallback(
    async (text: string, parentCommentId?: string) => {
      await postMutation.mutateAsync({ text, parentCommentId });
    },
    [postMutation],
  );

  const remove = useCallback(
    async (commentId: string) => {
      await deleteMutation.mutateAsync(commentId);
    },
    [deleteMutation],
  );

  return {
    comments: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
    post,
    remove,
    isPosting: postMutation.isPending,
  };
}
