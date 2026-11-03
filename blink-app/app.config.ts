import { ExpoConfig, ConfigContext } from 'expo/config';

// This file is the app's only Expo config (there is no app.json).

// EXPO_PUBLIC_API_URL is set per EAS build profile (see eas.json). Local dev
// leaves it unset and the app talks to the dev machine (services/api.ts).
// A release build without it fails here instead of pointing somewhere else.
const API_URL = process.env.EXPO_PUBLIC_API_URL;
const isReleaseBuild =
  ['preview', 'production'].includes(process.env.EAS_BUILD_PROFILE ?? '') || process.env.NODE_ENV === 'production';
if (isReleaseBuild && !API_URL) {
  throw new Error('EXPO_PUBLIC_API_URL must be set for a release build (see eas.json)');
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Blinks',
  slug: 'blink-app',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'blink',
  userInterfaceStyle: 'dark',
  newArchEnabled: true,
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#0A0A0F',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.yochaibar.blinks',
    associatedDomains: ['applinks:blink.app'],
    infoPlist: {
      NSCameraUsageDescription: 'Blink needs camera access to capture snap challenges with your friends.',
      ITSAppUsesNonExemptEncryption: false,
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          NSPrivacyAccessedAPITypeReasons: ['E174.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
        },
      ],
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhoneNumber',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhotosOrVideos',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherUserContent',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
      ],
      NSPrivacyTracking: false,
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0A0A0F',
    },
    edgeToEdgeEnabled: true,
    package: 'com.yochaibar.blinks',
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'https',
            host: 'blink.app',
            pathPrefix: '/join',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    ['expo-router', { origin: 'https://blink.app/' }],
    'expo-secure-store',
    [
      'expo-camera',
      {
        cameraPermission: 'Blink needs camera access to capture snap challenges with your friends.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/icon.png',
        color: '#FF6B4A',
      },
    ],
    [
      '@sentry/react-native/expo',
      {
        // Sentry org slug for source-map upload. Not recorded anywhere yet, so it
        // comes from the build env; EAS builds skip the upload anyway
        // (SENTRY_DISABLE_AUTO_UPLOAD in eas.json).
        organization: process.env.SENTRY_ORG,
        project: 'blink-app',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiUrl: API_URL,
    router: {
      origin: 'https://blink.app/',
    },
    eas: {
      projectId: '5377c833-4d39-4386-8880-9f67046357b1',
    },
  },
  owner: 'yoch_bar',
});
