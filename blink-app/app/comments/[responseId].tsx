import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Send, X } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import { useComments } from '@/hooks/useComments';
import { useAuthStore } from '@/stores/authStore';
import type { CommentItem } from '@/services/api';
import { toThreads } from '@/utils/commentThreads';
import { getRelativeTime } from '@/utils/time';

const MAX_LENGTH = 280;

/**
 * The full comment thread for one photo response: every comment and reply,
 * replying, and deleting your own. Reached from a photo's comment preview
 * and from the reveal screen. Live updates come from comment:* socket
 * events (services/socketEvents).
 */
export default function CommentsScreen() {
  const { responseId } = useLocalSearchParams<{ responseId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const selfId = useAuthStore((s) => s.user?.id);
  const { comments, isLoading, post, remove, isPosting } = useComments(responseId);
  const threads = useMemo(() => toThreads(comments), [comments]);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const trimmed = draft.trim();
  const canSend = !isPosting && trimmed.length > 0 && draft.length <= MAX_LENGTH;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const text = trimmed;
    const parentId = replyTo?.id;
    setDraft('');
    setReplyTo(null);
    try {
      await post(text, parentId);
    } catch {
      // The optimistic comment was rolled back; give the text back to retry.
      setDraft(text);
    }
  }, [canSend, trimmed, replyTo, post]);

  const handleDelete = useCallback(
    (comment: CommentItem) => {
      const doDelete = () => remove(comment.id).catch(() => Alert.alert('Could not delete comment'));
      if (Platform.OS === 'web') {
        if (window.confirm('Delete this comment?')) doDelete();
        return;
      }
      Alert.alert('Delete comment?', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    },
    [remove],
  );

  const renderComment = (comment: CommentItem, isReply: boolean) => (
    <View key={comment.id} style={[styles.comment, isReply && styles.reply]} testID={`comment-${comment.id}`}>
      <Text style={styles.text}>
        <Text style={styles.name}>{comment.display_name || 'Someone'} </Text>
        {comment.text}
      </Text>
      <View style={styles.meta}>
        <Text style={styles.metaText}>{getRelativeTime(comment.created_at)}</Text>
        {/* Replies are one level deep: replying to a reply answers its thread. */}
        <TouchableOpacity
          onPress={() =>
            setReplyTo(isReply ? (comments.find((c) => c.id === comment.parent_comment_id) ?? null) : comment)
          }
        >
          <Text style={styles.action}>Reply</Text>
        </TouchableOpacity>
        {comment.user_id === selfId && !comment.id.startsWith('optimistic-') ? (
          <TouchableOpacity onPress={() => handleDelete(comment)}>
            <Text style={styles.action}>Delete</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Comments</Text>
        <View style={styles.backBtn} />
      </View>

      {isLoading && comments.length === 0 ? (
        <ActivityIndicator color={theme.textMuted} style={styles.loading} />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.comment.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No comments yet. Say something nice.</Text>}
          renderItem={({ item }) => (
            <View>
              {renderComment(item.comment, false)}
              {item.replies.map((r) => renderComment(r, true))}
            </View>
          )}
        />
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {replyTo ? (
          <View style={styles.replyingTo}>
            <Text style={styles.metaText} numberOfLines={1}>
              Replying to {replyTo.display_name || 'Someone'}
            </Text>
            <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}>
              <X size={14} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.composerRow}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={replyTo ? 'Add a reply…' : 'Add a comment…'}
            placeholderTextColor={theme.textMuted}
            maxLength={MAX_LENGTH}
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={handleSend}
            testID="comments-input"
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!canSend}
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            testID="comments-send"
          >
            {isPosting ? (
              <ActivityIndicator size="small" color={theme.white} />
            ) : (
              <Send size={16} color={canSend ? theme.white : theme.textMuted} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { ...typography.headlineMedium, color: theme.text },
  loading: { marginTop: spacing.xl },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  empty: { ...typography.body, color: theme.textMuted, textAlign: 'center', marginTop: spacing.xl },
  comment: { gap: 2 },
  reply: { marginLeft: spacing.xl, marginTop: spacing.sm },
  text: { ...typography.body, color: theme.text },
  name: { fontWeight: '700' },
  meta: { flexDirection: 'row', gap: spacing.md },
  metaText: { ...typography.caption, color: theme.textMuted, flexShrink: 1 },
  action: { ...typography.caption, color: theme.textSecondary, fontWeight: '600' },
  composer: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  replyingTo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    ...typography.body,
    color: theme.text,
    backgroundColor: theme.bgCard,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: theme.bgCard },
});
