import React, { useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Animated, Dimensions, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Camera, Users, Zap, Sparkles, Phone } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';
import { useAuthStore } from '@/stores/authStore';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type OnboardingStep = 'welcome' | 'phone' | 'otp' | 'name';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const requestOtp = useAuthStore((s) => s.requestOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const updateName = useAuthStore((s) => s.updateName);

  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  const animateTransition = useCallback((nextStep: OnboardingStep) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -30, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setStep(nextStep);
      slideAnim.setValue(30);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    });
  }, [fadeAnim, slideAnim]);

  const handleNext = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    if (step === 'welcome') {
      animateTransition('phone');
      return;
    }

    if (step === 'phone' && phone.trim()) {
      setIsSubmitting(true);
      try {
        await requestOtp(phone.trim());
        animateTransition('otp');
      } catch (e: any) {
        Alert.alert('Error', e.message || 'Failed to send verification code');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (step === 'otp' && otp.trim().length === 6) {
      setIsSubmitting(true);
      try {
        await verifyOtp(phone.trim(), otp.trim());
        animateTransition('name');
      } catch (e: any) {
        Alert.alert('Error', e.message || 'Invalid verification code');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (step === 'name') {
      if (name.trim()) {
        updateName(name.trim());
      }
      router.replace('/');
    }
  }, [step, phone, otp, name, animateTransition, requestOtp, verifyOtp, updateName, router]);

  const isNextDisabled =
    isSubmitting ||
    (step === 'phone' && !phone.trim()) ||
    (step === 'otp' && otp.trim().length < 6);

  const features = [
    { icon: Camera, label: 'Snap Challenges', desc: 'Capture moments with your crew' },
    { icon: Users, label: 'Friend Groups', desc: 'Stay connected with who matters' },
    { icon: Zap, label: 'Daily Prompts', desc: 'Fun questions & quizzes every day' },
  ];

  const getButtonText = () => {
    if (isSubmitting) return 'Loading...';
    switch (step) {
      case 'welcome': return "Let's Go";
      case 'phone': return 'Send Code';
      case 'otp': return 'Verify';
      case 'name': return name.trim() ? 'Start Blinking' : 'Skip';
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0A0A0F', '#12081a', '#0A0A0F']}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.progressBar}>
            {(['welcome', 'phone', 'otp', 'name'] as const).map((s, i) => (
              <View
                key={s}
                style={[
                  styles.progressDot,
                  { backgroundColor: (['welcome', 'phone', 'otp', 'name'] as const).indexOf(step) >= i ? theme.coral : theme.surface },
                ]}
              />
            ))}
          </View>

          <Animated.View style={[styles.stepContent, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            {step === 'welcome' && (
              <View style={styles.centerContent}>
                <View style={styles.logoContainer}>
                  <LinearGradient
                    colors={[theme.coral, '#FF8A6E']}
                    style={styles.logoBg}
                  >
                    <Sparkles size={40} color={theme.white} />
                  </LinearGradient>
                </View>
                <Text style={styles.welcomeTitle}>Welcome to Blink</Text>
                <Text style={styles.welcomeSubtitle}>
                  Spontaneous moments with your favorite people
                </Text>

                <View style={styles.featureList}>
                  {features.map((feat, i) => {
                    const IconComp = feat.icon;
                    return (
                      <View key={i} style={styles.featureRow}>
                        <View style={[styles.featureIcon, { backgroundColor: `${theme.coral}18` }]}>
                          <IconComp size={20} color={theme.coral} />
                        </View>
                        <View style={styles.featureText}>
                          <Text style={styles.featureLabel}>{feat.label}</Text>
                          <Text style={styles.featureDesc}>{feat.desc}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {step === 'phone' && (
              <View style={styles.inputStep}>
                <View style={styles.stepIconContainer}>
                  <Phone size={32} color={theme.coral} />
                </View>
                <Text style={styles.stepTitle}>What's your number?</Text>
                <Text style={styles.stepSubtitle}>We'll send you a verification code</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+1 (555) 123-4567"
                  placeholderTextColor={theme.textMuted}
                  autoFocus
                  keyboardType="phone-pad"
                  maxLength={20}
                  returnKeyType="done"
                  onSubmitEditing={handleNext}
                  testID="onboarding-phone-input"
                />
              </View>
            )}

            {step === 'otp' && (
              <View style={styles.inputStep}>
                <Text style={styles.stepEmoji}>🔐</Text>
                <Text style={styles.stepTitle}>Enter verification code</Text>
                <Text style={styles.stepSubtitle}>Sent to {phone}</Text>
                <TextInput
                  style={styles.input}
                  value={otp}
                  onChangeText={setOtp}
                  placeholder="123456"
                  placeholderTextColor={theme.textMuted}
                  autoFocus
                  keyboardType="number-pad"
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={handleNext}
                  testID="onboarding-otp-input"
                />
              </View>
            )}

            {step === 'name' && (
              <View style={styles.inputStep}>
                <Text style={styles.stepEmoji}>👋</Text>
                <Text style={styles.stepTitle}>What's your name?</Text>
                <Text style={styles.stepSubtitle}>This is how friends will see you</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor={theme.textMuted}
                  autoFocus
                  maxLength={24}
                  returnKeyType="done"
                  onSubmitEditing={handleNext}
                  testID="onboarding-name-input"
                />
              </View>
            )}
          </Animated.View>

          <TouchableOpacity
            style={[styles.nextBtn, isNextDisabled && styles.nextBtnDisabled]}
            onPress={handleNext}
            disabled={isNextDisabled}
            activeOpacity={0.85}
            testID="onboarding-next-btn"
          >
            <Text style={[styles.nextBtnText, isNextDisabled && styles.nextBtnTextDisabled]}>
              {getButtonText()}
            </Text>
            <ArrowRight size={18} color={isNextDisabled ? theme.textMuted : theme.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  progressBar: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginBottom: 20,
  },
  progressDot: {
    width: 32,
    height: 4,
    borderRadius: 2,
  },
  stepContent: {
    flex: 1,
    justifyContent: 'center',
  },
  centerContent: {
    alignItems: 'center',
  },
  logoContainer: {
    marginBottom: 28,
  },
  logoBg: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcomeTitle: {
    fontSize: 32,
    fontWeight: '900' as const,
    color: theme.text,
    letterSpacing: -1,
    marginBottom: 10,
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
  },
  featureList: {
    width: '100%',
    gap: 16,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: theme.bgCard,
    padding: 16,
    borderRadius: 16,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureText: {
    flex: 1,
  },
  featureLabel: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: theme.text,
  },
  featureDesc: {
    fontSize: 13,
    color: theme.textMuted,
    marginTop: 2,
  },
  inputStep: {
    alignItems: 'center',
  },
  stepIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: `${theme.coral}18`,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  stepEmoji: {
    fontSize: 56,
    marginBottom: 20,
  },
  stepTitle: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: theme.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: 15,
    color: theme.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 21,
  },
  input: {
    width: '100%',
    backgroundColor: theme.bgCard,
    borderRadius: 16,
    padding: 18,
    fontSize: 18,
    color: theme.text,
    fontWeight: '600' as const,
    borderWidth: 1.5,
    borderColor: theme.border,
    textAlign: 'center',
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: theme.coral,
    borderRadius: 16,
    paddingVertical: 18,
  },
  nextBtnDisabled: {
    backgroundColor: theme.surface,
  },
  nextBtnText: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: theme.white,
  },
  nextBtnTextDisabled: {
    color: theme.textMuted,
  },
});
