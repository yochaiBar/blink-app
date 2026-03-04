// Disable autolinking for @react-native-firebase packages.
// Firebase native modules have pod compatibility issues with Expo SDK 54.
// The app uses server-side OTP for dev builds; Firebase will be re-enabled
// for production once pod compatibility is resolved.
module.exports = {
  dependencies: {
    '@react-native-firebase/app': {
      platforms: {
        ios: null,
        android: null,
      },
    },
    '@react-native-firebase/auth': {
      platforms: {
        ios: null,
        android: null,
      },
    },
  },
};
