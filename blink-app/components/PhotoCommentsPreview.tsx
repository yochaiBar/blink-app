import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Send } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { useComments } from '@/hooks/useComments';

const PREVIEW_LIMIT = 5;
const MAX_LENGTH = 280;
const SHOW_CHAR_WARN_AT = 240;

interface Props {
  responseId: string;
}

/**
 * Inline Instagram-style comment preview below a photo response.
 *
 * Phase 2 scope: shows up to PREVIEW_LIMIT top-level comments + composer.
 * Phase 3 will add the "View all X comments" bottom sheet + reply threading
 * display + long-press menu (report/delete). See:
 *   ~/Documents/Obsidian Vault/Blink/Plans/Photo comments.md
 */
export default function PhotoCommentsPreview({ responseId }: Props) {
  const { comments, isLoading, post, isPosting } = useComments(responseId);
  const [draft, setDraft] = useState('');

  // Phase 2 displays top-level comments only. Replies live behind the future
  // sheet — counting them here would mislead the user about the "View all"
  // total. Once Phase 3 lands, swap the count to `comments.length`.
  const topLevel = useMemo(
    () => comments.filter((c) => c.parent_comment_id === null),
    [comments],
  );

  const visible = topLevel.slice(0, PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, topLevel.length - PREVIEW_LIMIT);

  const trimmed = draft.trim();
  const charsLeft = MAX_LENGTH - draft.length;
  const canSend = !isPosting && trimmed.length > 0 && draft.length <= MAX_LENGTH;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const text = trimmed;
    setDraft('');
    try {
      await post(text);
    } catch {
      // Restore the draft so the user can retry. Optimistic insert was
      // already rolled back by useComments' onError handler.
      setDraft(text);
    }
  }, [canSend, trimmed, post]);

  return (
    <View style={styles.container} testID="photo-comments-preview">
      {isLoading && comments.length === 0 ? (
        <ActivityIndicator size="small" color={theme.textMuted} style={styles.loading} />
      ) : (
        <>
          {visible.map((c) => (
            <View key={c.id} style={styles.commentRow}>
              <Text style={styles.commentName}>{c.display_name || 'Someone'}</Text>
              <Text style={styles.commentText} numberOfLines={3}>
                {' '}{c.text}
              </Text>
            </View>
          ))}
          {hiddenCount > 0 ? (
            <Text style={styles.viewAll}>View all {topLevel.length} comments</Text>
          ) : null}
        </>
      )}

      <View style={styles.composerRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a comment…"
          placeholderTextColor={theme.textMuted}
          maxLength={MAX_LENGTH}
          returnKeyType="send"
          blurOnSubmit
          onSubmitEditing={handleSend}
          testID="comment-composer-input"
        />
        {draft.length >= SHOW_CHAR_WARN_AT ? (
          <Text style={styles.charCount}>{charsLeft}</Text>
        ) : null}
        <TouchableOpacity
          onPress={handleSend}
          disabled={!canSend}
          style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
          testID="comment-send-btn"
        >
          {isPosting ? (
            <ActivityIndicator size="small" color={theme.white} />
          ) : (
            <Send size={16} color={canSend ? theme.white : theme.textMuted} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  loading: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  commentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  commentName: {
    ...typography.bodySmall,
    color: theme.text,
    fontWeight: '700',
  },
  commentText: {
    ...typography.bodySmall,
    color: theme.text,
    flexShrink: 1,
  },
  viewAll: {
    ...typography.bodySmall,
    color: theme.textMuted,
    marginTop: spacing.xs,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: theme.bgCard,
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    color: theme.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: theme.border,
  },
  charCount: {
    fontSize: 11,
    color: theme.textMuted,
    minWidth: 24,
    textAlign: 'right',
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: theme.surface,
  },
});
