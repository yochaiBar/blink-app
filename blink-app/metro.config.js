const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// ---------------------------------------------------------------------------
// Stub out @react-native-firebase/* in Expo Go.
//
// Expo Go ships without the native modules that @react-native-firebase
// requires (RNFBAppModule, RNFBAuthModule, etc.). When Metro bundles these
// packages their initialisation code calls `new RNFBNativeEventEmitter()`
// which immediately throws "Native module RNFBAppModule not found".
//
// Strategy:
//   - `expo start`  (Expo Go)   -> stub Firebase (default)
//   - `expo run:*`  (dev build) -> use real Firebase (set EX_FIREBASE=1)
//   - EAS Build                 -> use real Firebase (set EX_FIREBASE=1 in eas.json)
//
// The authStore.ts already guards every Firebase call behind a null check,
// so the app works correctly with or without the real Firebase module.
// ---------------------------------------------------------------------------

const FIREBASE_STUB = path.resolve(__dirname, "stubs", "firebase.js");
const useRealFirebase = process.env.EX_FIREBASE === "1";

if (!useRealFirebase) {
  const originalResolveRequest = config.resolver.resolveRequest;

  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName.startsWith("@react-native-firebase/")) {
      return {
        filePath: FIREBASE_STUB,
        type: "sourceFile",
      };
    }

    if (originalResolveRequest) {
      return originalResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
