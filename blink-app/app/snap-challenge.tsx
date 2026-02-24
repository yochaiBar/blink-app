import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform, Dimensions, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Check, RotateCcw, SwitchCamera } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';
import { LinearGradient } from 'expo-linear-gradient';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type ChallengePhase = 'countdown' | 'capture' | 'preview';

export default function SnapChallengeScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
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
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const group = groups.find(g => g.id === groupId);
  const isWeb = Platform.OS === 'web';
  const hasCamera = permission?.granted && !isWeb;

  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) {
      Alert.alert(
        'Camera Access',
        'Blink needs your camera to capture snap challenges with friends. Allow access?',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Allow', onPress: () => requestPermission() },
        ],
      );
    }
  }, [permission]);

  useEffect(() => {
    if (phase === 'countdown' && countdownValue > 0) {
      Animated.sequence([
        Animated.parallel([
          Animated.timing(countdownScale, { toValue: 1.4, duration: 400, useNativeDriver: true }),
          Animated.timing(countdownOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(countdownScale, { toValue: 0.6, duration: 0, useNativeDriver: true }),
          Animated.timing(countdownOpacity, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
        Animated.timing(countdownScale, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();

      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const timer = setTimeout(() => {
        setCountdownValue(prev => prev - 1);
      }, 1000);

      return () => clearTimeout(timer);
    } else if (phase === 'countdown' && countdownValue === 0) {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }
      setPhase('capture');
    }
  }, [phase, countdownValue, countdownScale, countdownOpacity]);

  useEffect(() => {
    if (phase === 'capture') {
      Animated.timing(progressAnim, {
        toValue: 0,
        duration: 10000,
        useNativeDriver: false,
      }).start();

      captureTimerRef.current = setInterval(() => {
        setCaptureTimer(prev => {
          if (prev <= 1) {
            if (captureTimerRef.current) clearInterval(captureTimerRef.current);
            handleCapture();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        if (captureTimerRef.current) clearInterval(captureTimerRef.current);
      };
    }
  }, [phase]);

  const handleCapture = useCallback(async () => {
    if (captureTimerRef.current) clearInterval(captureTimerRef.current);

    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
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
        // Camera capture failed — user will see placeholder preview
      }
    }

    setPhase('preview');
  }, [flashAnim, hasCamera, cameraReady]);

  const handleSubmit = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    await submitSnap(groupId ?? '', capturedUri ?? undefined);
    router.back();
  }, [submitSnap, groupId, router, capturedUri]);

  const handleRetake = useCallback(() => {
    setPhase('countdown');
    setCountdownValue(3);
    setCaptureTimer(10);
    setCapturedUri(null);
    progressAnim.setValue(1);
  }, [progressAnim]);

  const toggleFacing = useCallback(() => {
    setFacing(prev => (prev === 'back' ? 'front' : 'back'));
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
  }, []);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

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
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>Grant Permission</Text>
          </TouchableOpacity>
        )}
      </LinearGradient>
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
          <TouchableOpacity
            style={[styles.closeBtn, { top: insets.top + 10 }]}
            onPress={() => router.back()}
          >
            <X size={22} color={theme.text} />
          </TouchableOpacity>

          <Text style={styles.challengeLabel}>📸 SNAP CHALLENGE</Text>
          <Text style={styles.groupLabel}>{group?.emoji} {group?.name}</Text>

          <Animated.View style={[styles.countdownCircle, { transform: [{ scale: countdownScale }], opacity: countdownOpacity }]}>
            <Text style={styles.countdownNumber}>{countdownValue}</Text>
          </Animated.View>

          <Text style={styles.getReady}>Get ready...</Text>
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

          <View style={styles.timerBar}>
            <Animated.View style={[styles.timerProgress, { width: progressWidth }]} />
          </View>

          <Text style={styles.captureTimerText}>{captureTimer}s</Text>

          <View style={styles.cameraPlaceholder}>
            {renderCameraView()}
          </View>

          <View style={[styles.captureControls, { paddingBottom: insets.bottom + 20 }]}>
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
                <TouchableOpacity style={styles.flipBtn} onPress={toggleFacing}>
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
              <Image source={{ uri: capturedUri }} style={styles.previewPhoto} contentFit="cover" />
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

          <View style={[styles.previewControls, { paddingBottom: insets.bottom + 20 }]}>
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
  countdownContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  challengeLabel: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: theme.coral,
    letterSpacing: 2,
  },
  groupLabel: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: theme.textSecondary,
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
    marginVertical: 20,
  },
  countdownNumber: {
    fontSize: 64,
    fontWeight: '900' as const,
    color: theme.coral,
    fontVariant: ['tabular-nums'],
  },
  getReady: {
    fontSize: 16,
    color: theme.textMuted,
    fontWeight: '500' as const,
  },
  captureContainer: {
    flex: 1,
  },
  timerBar: {
    height: 4,
    backgroundColor: theme.surface,
    marginHorizontal: 20,
    marginTop: 60,
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
    fontWeight: '900' as const,
    color: theme.coral,
    textAlign: 'center',
    marginTop: 20,
    fontVariant: ['tabular-nums'],
  },
  cameraPlaceholder: {
    flex: 1,
    marginHorizontal: 20,
    marginVertical: 20,
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
    fontSize: 16,
    fontWeight: '600' as const,
    color: theme.textMuted,
  },
  cameraSubtext: {
    fontSize: 13,
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
    fontSize: 14,
    fontWeight: '700' as const,
    color: theme.white,
  },
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
    fontSize: 22,
    fontWeight: '800' as const,
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
    fontSize: 16,
    fontWeight: '700' as const,
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
    fontWeight: '800' as const,
    color: theme.white,
  },
  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.white,
  },
});
