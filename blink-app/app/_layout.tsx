import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import * as Sentry from "@sentry/react-native";
import { AppProvider } from "@/providers/AppProvider";
import { useAuthStore, initFirebaseAuth } from "@/stores/authStore";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { theme } from "@/constants/colors";
import * as Notifications from "expo-notifications";
import {
  sendPushTokenToServer,
  addNotificationListener,
  getNotificationRoute,
  setBadgeCount,
} from "@/utils/notifications";
import { OfflineBanner } from "@/components/ui";
import * as Linking from "expo-linking";
import { useSocket } from "@/hooks/useSocket";

// ---------------------------------------------------------------------------
// Firebase initialisation (dev builds only).
//
// In Expo Go the Metro resolver stubs @react-native-firebase/* with an empty
// module so the import below resolves harmlessly. We then detect whether the
// real native module is present by checking that the imported object exposes
// the expected `auth` function. If it does, we hand it to the auth store so
// Firebase phone auth is used for OTP. Otherwise the store falls back to the
// server-side dev OTP flow.
// ---------------------------------------------------------------------------
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const firebaseAuth = require("@react-native-firebase/auth");
  // The stub returns `{}`, so `firebaseAuth.default` will be undefined.
  // The real package exports `default` which is the auth() callable.
  if (typeof firebaseAuth === "function" || typeof firebaseAuth?.default === "function") {
    initFirebaseAuth(firebaseAuth.default ?? firebaseAuth);
  }
} catch {
  // Firebase native modules unavailable (Expo Go) -- fall back to dev OTP.
}

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN || "",
  // Disable in dev to avoid noise
  enabled: !__DEV__,
  tracesSampleRate: 0.2,
  sendDefaultPii: false,
});

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function AuthGate({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const router = useRouter();
  const segments = useSegments();

  // Manage Socket.io connection (connects when authenticated, disconnects on logout)
  useSocket();

  useEffect(() => {
    restoreSession();
    useOnboardingStore.getState().hydrate();
  }, []);

  useEffect(() => {
    if (isLoading) return;
    SplashScreen.hideAsync();

    const inOnboarding = (segments[0] as string) === "onboarding";

    if (!isAuthenticated && !inOnboarding) {
      router.replace("/onboarding" as never);
    } else if (isAuthenticated && inOnboarding) {
      router.replace("/" as never);
    }

    if (isAuthenticated && Platform.OS !== "web") {
      // Register push token with the backend (fire-and-forget)
      sendPushTokenToServer();
    }
  }, [isAuthenticated, isLoading, segments]);

  // ── Notification tap handling ──────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || isLoading) return;

    // Clear badge when app becomes active
    setBadgeCount(0);

    // Handle cold-start: app was killed and user tapped a notification to open it
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        const data = response.notification.request.content.data as
          | Record<string, any>
          | undefined;
        const route = getNotificationRoute(data);
        if (route) {
          router.push(route as never);
        }
      }
    });

    const cleanup = addNotificationListener(
      // onReceived: notification arrives while app is in foreground
      (_notification) => {
        // No-op: the default handler shows the alert. Could invalidate
        // queries here if desired.
      },
      // onResponse: user tapped the notification
      (response) => {
        const data = response.notification.request.content.data as
          | Record<string, any>
          | undefined;

        const route = getNotificationRoute(data);
        if (route) {
          router.push(route as never);
        }

        // Clear badge after tap
        setBadgeCount(0);
      },
    );

    return cleanup;
  }, [isAuthenticated, isLoading, router]);

  // Handle deep links: blink://join/CODE or https://blink.app/join/CODE
  useEffect(() => {
    if (!isAuthenticated || isLoading) return;

    const handleUrl = (event: { url: string }) => {
      const parsed = Linking.parse(event.url);
      // Match path like /join/ABCDEF
      if (parsed.path?.startsWith("join/")) {
        const code = parsed.path.replace("join/", "");
        if (code) {
          router.push({ pathname: "/join-group" as never, params: { code } });
        }
      }
    };

    // Handle URL that opened the app
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    // Handle URLs while app is running
    const subscription = Linking.addEventListener("url", handleUrl);
    return () => subscription.remove();
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.coral} />
      </View>
    );
  }

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <AuthGate>
      <Stack
        screenOptions={{
          headerBackTitle: "Back",
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="onboarding"
          options={{
            headerShown: false,
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="create-group"
          options={{
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="snap-challenge"
          options={{
            presentation: "fullScreenModal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="quiz-challenge"
          options={{
            presentation: "fullScreenModal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="challenge-history"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="group-detail"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="group-prompt"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="group-leaderboard"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="join-group"
          options={{
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="invite-members"
          options={{
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="notifications"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="edit-profile"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="help-faq"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen name="+not-found" />
      </Stack>
    </AuthGate>
  );
}

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AppProvider>
          <StatusBar style="light" />
          <OfflineBanner visible={false} />
          <RootLayoutNav />
        </AppProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}

export default Sentry.wrap(RootLayout);

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.bg,
  },
});
