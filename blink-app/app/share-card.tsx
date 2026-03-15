import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Share2, Download } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import ShareCard from '@/components/ShareCard';
import { captureShareCard, shareImage, saveToCameraRoll } from '@/utils/shareCard';

export default function ShareCardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const {
    photoUri,
    prompt,
    userName,
    userAvatar,
    groupName,
    groupEmoji,
    responseTimeSec,
  } = useLocalSearchParams<{
    photoUri: string;
    prompt: string;
    userName: string;
    userAvatar: string;
    groupName: string;
    groupEmoji?: string;
    responseTimeSec?: string;
  }>();

  const cardRef = useRef<View>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const responseTimeNum =
    responseTimeSec != null ? parseFloat(responseTimeSec) : undefined;

  const handleShare = useCallback(async () => {
    if (isCapturing) return;
    setIsCapturing(true);

    try {
      const uri = await captureShareCard(cardRef as React.RefObject<View>);
      await shareImage(uri);

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      Alert.alert('Share Failed', 'Could not share the image. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);

    try {
      const uri = await captureShareCard(cardRef as React.RefObject<View>);
      const saved = await saveToCameraRoll(uri);

      if (saved) {
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        Alert.alert('Saved', 'Image saved to your camera roll.');
      }
    } catch {
      Alert.alert('Save Failed', 'Could not save the image. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [isSaving]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  // Fallback for missing data
  if (!photoUri || !prompt || !userName || !groupName) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <ArrowLeft size={20} color={theme.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Share Card</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Missing share data. Please go back and try again.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <ArrowLeft size={20} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Share Card</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Preview area */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.previewContainer}>
          <View style={styles.previewCard} collapsable={false} ref={cardRef}>
            <ShareCard
              photoUri={photoUri}
              prompt={prompt}
              userName={userName}
              userAvatar={userAvatar ?? ''}
              groupName={groupName}
              groupEmoji={groupEmoji}
              responseTimeSec={responseTimeNum}
            />
          </View>
        </View>
      </ScrollView>

      {/* Action buttons */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleShare}
          activeOpacity={0.85}
          disabled={isCapturing}
        >
          {isCapturing ? (
            <ActivityIndicator size="small" color={theme.white} />
          ) : (
            <>
              <Share2 size={18} color={theme.white} />
              <Text style={styles.primaryBtnText}>Share to Stories</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={handleSave}
          activeOpacity={0.7}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={theme.textSecondary} />
          ) : (
            <>
              <Download size={18} color={theme.textSecondary} />
              <Text style={styles.secondaryBtnText}>Save to Camera Roll</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backLinkBtn}
          onPress={handleBack}
          activeOpacity={0.7}
        >
          <Text style={styles.backLinkText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    ...typography.headlineMedium,
    color: theme.text,
    flex: 1,
    textAlign: 'center',
  },
  headerRight: {
    width: 36,
  },

  /* Preview */
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  previewContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCard: {
    // Scale down the 1080x1920 card to fit the preview.
    // On a ~390pt wide phone we want about 300pt wide preview.
    width: 1080,
    height: 1920,
    transform: [{ scale: 0.28 }],
    transformOrigin: 'top center',
    borderRadius: 24,
    overflow: 'hidden',
    // Shadow for the preview card
    shadowColor: theme.coral,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
  },

  /* Actions */
  actionsContainer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: theme.coral,
    paddingVertical: 16,
    borderRadius: borderRadius.lg,
  },
  primaryBtnText: {
    ...typography.bodyBold,
    color: theme.white,
    fontWeight: '800',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: theme.bgCardSolid,
    paddingVertical: 14,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.border,
  },
  secondaryBtnText: {
    ...typography.bodyBold,
    color: theme.textSecondary,
  },
  backLinkBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  backLinkText: {
    ...typography.body,
    color: theme.textMuted,
  },

  /* Error state */
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  errorText: {
    ...typography.body,
    color: theme.textMuted,
    textAlign: 'center',
  },
});
