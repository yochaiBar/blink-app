import React, { useState, useEffect, useRef, useCallback, ErrorInfo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
  Dimensions,
  Alert,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Check, RotateCcw, SwitchCamera } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { useApp } from '@/providers/AppProvider';
import { api } from '@/services/api';
import { LinearGradient } from 'expo-linear-gradient';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { ApiChallenge } from '@/types/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type ChallengePhase = 'countdown' | 'capture' | 'preview';

interface ProgressData {
  total_members: number;
  responded_count: number;
  respondents: Array<{
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
  }>;
}

function SnapChallengeScreen() {
  const { groupId, challengeId } = useLocalSearchParams<{
    groupId: string;
    challengeId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { submitSnap, groups } = useApp();

  const [phase, setPhase] = useState<ChallengePhase>('countdown');
  const [countdownValue, setCountdownValue] = useState<number>(3);
  const [captureTimer, setCaptureTimer] = useState<number>(10);
  const [facing, setFacing] = useState<CameraType>('back');
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState<boolean>(false);

  const cameraRef = useRef<CameraView>(null);
  const countdownScale = useRef(new Animated.Value(1)).current;
  const countdownOpacity = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(1)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;
  const shutterScale = useRef(new Animated.Value(1)).current;
  const edgeGlowAnim = useRef(new Animated.Value(0)).current;
  const urgentPulseAnim = useRef(new Animated.Value(1)).current;
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const group = groups.find((g) => g.id === groupId);
  const isWeb = Platform.OS === 'web';
  const hasCamera = permission?.granted && !isWeb;

  // Fetch active challenge details (prompt text, etc.)
  const challengeQuery = useQuery({
    queryKey: ['active-challenge', groupId, challengeId],
    queryFn: async (): Promise<ApiChallenge> => {
      if (challengeId) {
        return api(`/challenges/${challengeId}`);
      }
      return api(`/challenges/groups/${groupId}/challenges/active`);
    },
    enabled: !!groupId,
    staleTime: 60_000,
  });

  const challengeData = challengeQuery.data;
  const promptText =
    challengeData?.prompt_text ?? challengeData?.prompt ?? null;
  const resolvedChallengeId = challengeId ?? challengeData?.id;

  // Fetch progress (who has responded)
  const progressQuery = useQuery({
    queryKey: ['challenge-progress', resolvedChallengeId],
    queryFn: async (): Promise<ProgressData> => {
      return api(`/challenges/${resolvedChallengeId}/progress`);
    },
    enabled: !!resolvedChallengeId && phase !== 'preview',
    refetchInterval: 5000, // Poll every 5s during active challenge
  });

  const progress = progressQuery.data;

  // ── Camera permission ──
  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) {
      Alert.alert(
        'Camera Access',
        'Blink needs your camera to capture snap challenges with friends. Allow access?',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Allow', onPress: () => requestPermission() },
        ]
      );
    }
  }, [permission]);

  // ── Countdown phase ──
  useEffect(() => {
    if (phase === 'countdown' && countdownValue > 0) {
      Animated.sequence([
        Animated.parallel([
          Animated.timing(countdownScale, {
            toValue: 1.4,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(countdownOpacity, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(countdownScale, {
            toValue: 0.6,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(countdownOpacity, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(countdownScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const timer = setTimeout(() => {
        setCountdownValue((prev) => prev - 1);
      }, 1000);

      return () => clearTimeout(timer);
    } else if (phase === 'countdown' && countdownValue === 0) {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }
      setPhase('capture');
    }
  }, [phase, countdownValue, countdownScale, countdownOpacity]);

  // ── Capture phase timer + enhanced haptics ──
  useEffect(() => {
    if (phase === 'capture') {
      Animated.timing(progressAnim, {
        toValue: 0,
        duration: 10000,
        useNativeDriver: false,
      }).start();

      captureTimerRef.current = setInterval(() => {
        setCaptureTimer((prev) => {
          if (prev <= 1) {
            if (captureTimerRef.current)
              clearInterval(captureTimerRef.current);
            handleCapture();
            return 0;
          }

          // Enhanced haptic feedback based on remaining time
          if (Platform.OS !== 'web') {
            if (prev <= 4 && prev > 1) {
              // Last 3 seconds: escalating haptics
              if (prev === 4) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              } else if (prev === 3) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              } else if (prev === 2) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              }
            } else if (prev > 4) {
              // 10-4 seconds: light haptic
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
          }

          return prev - 1;
        });
      }, 1000);

      return () => {
        if (captureTimerRef.current) clearInterval(captureTimerRef.current);
      };
    }
  }, [phase]);

  // ── Edge glow + pulse for last 3 seconds ──
  useEffect(() => {
    if (phase === 'capture' && captureTimer <= 3 && captureTimer > 0) {
      // Pulsing edge glow
      Animated.loop(
        Animated.sequence([
          Animated.timing(edgeGlowAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: false,
          }),
          Animated.timing(edgeGlowAnim, {
            toValue: 0.3,
            duration: 300,
            useNativeDriver: false,
          }),
        ])
      ).start();

      // Pulsing timer text
      Animated.loop(
        Animated.sequence([
          Animated.timing(urgentPulseAnim, {
            toValue: 1.3,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(urgentPulseAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      edgeGlowAnim.setValue(0);
      urgentPulseAnim.setValue(1);
    }
  }, [phase, captureTimer]);

  const handleCapture = useCallback(async () => {
    if (captureTimerRef.current) clearInterval(captureTimerRef.current);

    // Shutter animation: quick scale-down + flash + spring back
    Animated.parallel([
      Animated.sequence([
        Animated.timing(flashAnim, {
          toValue: 1,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.timing(flashAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(shutterScale, {
          toValue: 0.92,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.spring(shutterScale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 18,
          bounciness: 6,
        }),
      ]),
    ]).start();

    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    if (hasCamera && cameraReady && cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          base64: true,
        });
        if (photo?.base64) {
          setCapturedUri(`data:image/jpeg;base64,${photo.base64}`);
        } else if (photo?.uri) {
          setCapturedUri(photo.uri);
        }
      } catch {
        // Camera capture failed -- user will see placeholder preview
      }
    }

    setPhase('preview');
  }, [flashAnim, shutterScale, hasCamera, cameraReady]);

  const handleSubmit = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    try {
      await submitSnap(groupId ?? '', capturedUri ?? undefined);
      // Navigate to challenge reveal instead of going back
      if (resolvedChallengeId) {
        router.replace({
          pathname: '/challenge-reveal' as never,
          params: {
            challengeId: resolvedChallengeId,
            groupId: groupId ?? '',
          },
        });
      } else {
        router.back();
      }
    } catch (err) {
      Alert.alert('Upload Failed', 'Could not submit your snap. Please try again.');
    }
  }, [submitSnap, groupId, router, capturedUri, resolvedChallengeId]);

  const handleRetake = useCallback(() => {
    setPhase('countdown');
    setCountdownValue(3);
    setCaptureTimer(10);
    setCapturedUri(null);
    progressAnim.setValue(1);
  }, [progressAnim]);

  const toggleFacing = useCallback(() => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
  }, []);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const edgeGlowOpacity = edgeGlowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.6],
  });

  const isUrgent = phase === 'capture' && captureTimer <= 3;

  const renderCameraView = () => {
    if (hasCamera) {
      return (
        <CameraView
          ref={cameraRef}
          style={styles.cameraFull}
          facing={facing}
          onCameraReady={() => {
            setCameraReady(true);
          }}
        />
      );
    }

    return (
      <LinearGradient
        colors={['#1a1a2e', '#16213e', '#0f3460']}
        style={styles.cameraGradient}
      >
        <Text style={styles.cameraEmoji}>📸</Text>
        <Text style={styles.cameraText}>
          {isWeb ? 'Camera not available on web' : 'Camera permission needed'}
        </Text>
        <Text style={styles.cameraSubtext}>Tap the shutter to capture!</Text>
        {!isWeb && !permission?.granted && (
          <TouchableOpacity
            style={styles.permissionBtn}
            onPress={requestPermission}
          >
            <Text style={styles.permissionBtnText}>Grant Permission</Text>
          </TouchableOpacity>
        )}
      </LinearGradient>
    );
  };

  // Render the progress indicator (who has responded)
  const renderProgressIndicator = () => {
    if (!progress) return null;
    const { total_members, responded_count, respondents } = progress;
    return (
      <View style={styles.progressIndicator}>
        <View style={styles.progressAvatars}>
          {respondents.slice(0, 4).map((r, i) => (
            <Image
              key={r.user_id}
              source={{
                uri:
                  r.avatar_url ??
                  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop',
              }}
              style={[
                styles.progressAvatar,
                { marginLeft: i > 0 ? -8 : 0, zIndex: 10 - i },
              ]}
              contentFit="cover"
            />
          ))}
        </View>
        <Text style={styles.progressText}>
          {responded_count}/{total_members} responded
        </Text>
      </View>
    );
  };

  // Render the prompt overlay on the camera
  const renderPromptOverlay = () => {
    if (!promptText) return null;
    return (
      <View style={styles.promptOverlay}>
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.7)']}
          style={styles.promptGradient}
        >
          <Text style={styles.promptText}>{promptText}</Text>
        </LinearGradient>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0A0A0F', '#1a0a1e', '#0A0A0F']}
        style={StyleSheet.absoluteFill}
      />

      {phase === 'countdown' && (
        <View style={[styles.countdownContainer, { paddingTop: insets.top }]}>
          {/* Camera starts immediately behind the countdown */}
          <View style={styles.countdownCameraBg}>
            {renderCameraView()}
            <View style={styles.countdownCameraOverlay} />
          </View>

          <TouchableOpacity
            style={[styles.closeBtn, { top: insets.top + 10 }]}
            onPress={() => router.back()}
          >
            <X size={22} color={theme.text} />
          </TouchableOpacity>

          <View style={styles.countdownContent}>
            <Text style={styles.challengeLabel}>SNAP CHALLENGE</Text>
            <Text style={styles.groupLabel}>
              {group?.emoji} {group?.name}
            </Text>

            {promptText && (
              <View style={styles.countdownPromptCard}>
                <Text style={styles.countdownPromptText}>{promptText}</Text>
              </View>
            )}

            <Animated.View
              style={[
                styles.countdownCircle,
                {
                  transform: [{ scale: countdownScale }],
                  opacity: countdownOpacity,
                },
              ]}
            >
              <Text style={styles.countdownNumber}>{countdownValue}</Text>
            </Animated.View>

            <Text style={styles.getReady}>Get ready...</Text>
          </View>
        </View>
      )}

      {phase === 'capture' && (
        <View style={[styles.captureContainer, { paddingTop: insets.top }]}>
          <TouchableOpacity
            style={[styles.closeBtn, { top: insets.top + 10 }]}
            onPress={() => router.back()}
          >
            <X size={22} color={theme.text} />
          </TouchableOpacity>

          {/* Top bar: group name + progress + timer */}
          <View style={[styles.topBar, { marginTop: insets.top + 50 }]}>
            <View style={styles.topBarLeft}>
              <Text style={styles.topBarGroupName}>
                {group?.emoji} {group?.name}
              </Text>
              {renderProgressIndicator()}
            </View>
          </View>

          <View style={styles.timerBar}>
            <Animated.View
              style={[
                styles.timerProgress,
                {
                  width: progressWidth,
                  backgroundColor: isUrgent ? theme.coral : theme.coral,
                },
              ]}
            />
          </View>

          <Animated.Text
            style={[
              styles.captureTimerText,
              isUrgent && styles.captureTimerUrgent,
              { transform: [{ scale: urgentPulseAnim }] },
            ]}
          >
            {captureTimer}s
          </Animated.Text>

          <Animated.View style={[styles.cameraPlaceholder, { transform: [{ scale: shutterScale }] }]}>
            {renderCameraView()}
            {renderPromptOverlay()}
          </Animated.View>

          {/* Edge glow for last 3 seconds */}
          {isUrgent && (
            <Animated.View
              style={[styles.edgeGlow, { opacity: edgeGlowOpacity }]}
              pointerEvents="none"
            />
          )}

          <View
            style={[
              styles.captureControls,
              { paddingBottom: insets.bottom + 20 },
            ]}
          >
            <View style={styles.captureControlsInner}>
              <View style={{ width: 50 }} />
              <TouchableOpacity
                style={styles.shutterBtn}
                onPress={handleCapture}
                activeOpacity={0.85}
                testID="shutter-btn"
              >
                <View style={styles.shutterInner} />
              </TouchableOpacity>
              {hasCamera ? (
                <TouchableOpacity
                  style={styles.flipBtn}
                  onPress={toggleFacing}
                >
                  <SwitchCamera size={22} color={theme.white} />
                </TouchableOpacity>
              ) : (
                <View style={{ width: 50 }} />
              )}
            </View>
          </View>
        </View>
      )}

      {phase === 'preview' && (
        <View style={[styles.previewContainer, { paddingTop: insets.top }]}>
          <View style={styles.previewImage}>
            {capturedUri ? (
              <Image
                source={{ uri: capturedUri }}
                style={styles.previewPhoto}
                contentFit="cover"
              />
            ) : (
              <LinearGradient
                colors={['#1a1a2e', '#16213e', '#0f3460']}
                style={styles.previewGradient}
              >
                <Text style={styles.previewEmoji}>📸</Text>
                <Text style={styles.previewText}>Snap captured!</Text>
              </LinearGradient>
            )}
          </View>

          <View
            style={[
              styles.previewControls,
              { paddingBottom: insets.bottom + 20 },
            ]}
          >
            <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake}>
              <RotateCcw size={20} color={theme.text} />
              <Text style={styles.retakeBtnText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.submitBtn}
              onPress={handleSubmit}
              activeOpacity={0.85}
              testID="submit-snap-btn"
            >
              <Check size={20} color={theme.white} />
              <Text style={styles.submitBtnText}>Send it!</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Animated.View
        style={[styles.flash, { opacity: flashAnim }]}
        pointerEvents="none"
      />
    </View>
  );
}

// Error boundary to catch crashes and show error instead of crashing
class SnapErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SnapChallenge crash:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0A0A0F', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ color: '#FF6B4A', fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>Something went wrong</Text>
          <ScrollView style={{ maxHeight: 200 }}>
            <Text style={{ color: '#fff', fontSize: 12 }}>{this.state.error.message}</Text>
            <Text style={{ color: '#888', fontSize: 10, marginTop: 5 }}>{this.state.error.stack?.slice(0, 500)}</Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function SnapChallengeWithBoundary() {
  return (
    <SnapErrorBoundary>
      <SnapChallengeScreen />
    </SnapErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  closeBtn: {
    position: 'absolute',
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },

  // ── Countdown ──
  countdownContainer: {
    flex: 1,
  },
  countdownCameraBg: {
    ...StyleSheet.absoluteFillObject,
  },
  countdownCameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 10, 15, 0.85)',
  },
  countdownContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    zIndex: 2,
  },
  challengeLabel: {
    ...typography.labelSmall,
    color: theme.coral,
    letterSpacing: 3,
  },
  groupLabel: {
    ...typography.headlineMedium,
    color: theme.textSecondary,
  },
  countdownPromptCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 16,
    marginHorizontal: 32,
    marginTop: 4,
  },
  countdownPromptText: {
    ...typography.headlineLarge,
    color: theme.text,
    textAlign: 'center',
  },
  countdownCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: theme.coralMuted,
    borderWidth: 3,
    borderColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 16,
  },
  countdownNumber: {
    fontSize: 64,
    fontWeight: '900',
    color: theme.coral,
    fontVariant: ['tabular-nums'],
  },
  getReady: {
    ...typography.bodyLarge,
    color: theme.textMuted,
    fontWeight: '500',
  },

  // ── Capture ──
  captureContainer: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarGroupName: {
    ...typography.bodyBold,
    color: theme.text,
  },
  timerBar: {
    height: 4,
    backgroundColor: theme.surface,
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 2,
    overflow: 'hidden',
  },
  timerProgress: {
    height: '100%',
    backgroundColor: theme.coral,
    borderRadius: 2,
  },
  captureTimerText: {
    fontSize: 48,
    fontWeight: '900',
    color: theme.coral,
    textAlign: 'center',
    marginTop: 12,
    fontVariant: ['tabular-nums'],
  },
  captureTimerUrgent: {
    color: theme.coral,
    textShadowColor: theme.coral,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  cameraPlaceholder: {
    flex: 1,
    marginHorizontal: 20,
    marginVertical: 12,
    borderRadius: 20,
    overflow: 'hidden',
  },
  cameraFull: {
    flex: 1,
  },
  cameraGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  cameraEmoji: {
    fontSize: 48,
  },
  cameraText: {
    ...typography.bodyBold,
    color: theme.textMuted,
  },
  cameraSubtext: {
    ...typography.caption,
    color: theme.textMuted,
    opacity: 0.7,
  },
  permissionBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.coral,
  },
  permissionBtnText: {
    ...typography.bodyBold,
    color: theme.white,
  },

  // ── Prompt overlay on camera ──
  promptOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  promptGradient: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 20,
  },
  promptText: {
    ...typography.headlineLarge,
    color: theme.white,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // ── Progress indicator ──
  progressIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.bg,
  },
  progressText: {
    ...typography.caption,
    color: theme.textSecondary,
    fontVariant: ['tabular-nums'],
  },

  // ── Edge glow (urgent) ──
  edgeGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
    borderColor: theme.coral,
    borderRadius: 0,
    shadowColor: theme.coral,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 10,
  },

  // ── Capture controls ──
  captureControls: {
    paddingHorizontal: 20,
  },
  captureControlsInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  shutterBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: theme.white,
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInner: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
    backgroundColor: theme.coral,
  },
  flipBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Preview ──
  previewContainer: {
    flex: 1,
  },
  previewImage: {
    flex: 1,
    marginHorizontal: 20,
    marginTop: 60,
    marginBottom: 20,
    borderRadius: 20,
    overflow: 'hidden',
  },
  previewPhoto: {
    flex: 1,
  },
  previewGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  previewEmoji: {
    fontSize: 64,
  },
  previewText: {
    ...typography.h2,
    color: theme.text,
  },
  previewControls: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
  },
  retakeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: theme.bgCard,
  },
  retakeBtnText: {
    ...typography.bodyBold,
    color: theme.text,
  },
  submitBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: theme.coral,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.white,
  },

  // ── Flash ──
  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.white,
  },
});
