import { ExpoConfig, ConfigContext } from 'expo/config';

// API_URL is set per EAS build profile (see eas.json).
// Falls back to localhost for local web dev and LAN IP for device dev.
const API_URL = process.env.API_URL || 'https://blink-api-production.up.railway.app/api';

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
    googleServicesFile: './GoogleService-Info.plist',
    associatedDomains: ['applinks:blink.app'],
    infoPlist: {
      NSCameraUsageDescription:
        'Blink needs camera access to capture snap challenges with your friends.',
      NSPhotoLibraryUsageDescription:
        'Blink needs photo library access to set your profile picture.',
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
          NSPrivacyCollectedDataTypePurposes: [
            'NSPrivacyCollectedDataTypePurposeAppFunctionality',
          ],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhotosOrVideos',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: [
            'NSPrivacyCollectedDataTypePurposeAppFunctionality',
          ],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherUserContent',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: [
            'NSPrivacyCollectedDataTypePurposeAppFunctionality',
          ],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: [
            'NSPrivacyCollectedDataTypePurposeAppFunctionality',
          ],
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
    googleServicesFile: './google-services.json',
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
    'expo-font',
    'expo-web-browser',
    'expo-secure-store',
    [
      'expo-camera',
      {
        cameraPermission:
          'Blink needs camera access to capture snap challenges with your friends.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Blink needs photo library access to set your profile picture.',
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
        organization: 'REPLACE_WITH_SENTRY_ORG',
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
