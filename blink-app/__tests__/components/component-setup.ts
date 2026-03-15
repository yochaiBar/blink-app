/**
 * Component Test Setup - blink-app
 *
 * Provides React Native mocks suitable for react-test-renderer rendering.
 * Uses functional components instead of string replacements so that
 * react-test-renderer can actually render the component tree.
 */

import React from 'react';

// Helper to create a simple functional mock component
function mockComponent(name: string) {
  const Component = (props: any) =>
    React.createElement(name, props, props.children);
  Component.displayName = name;
  return Component;
}

// ── Mock React Native ─────────────────────────────────────────────
jest.mock('react-native', () => {
  const React = require('react');

  const mockAnimatedValue = () => ({
    interpolate: jest.fn().mockReturnValue(0),
    setValue: jest.fn(),
    _value: 1,
  });

  return {
    Platform: {
      OS: 'ios',
      select: jest.fn((obj: any) => obj.ios || obj.default),
    },
    StyleSheet: {
      create: (styles: any) => styles,
      absoluteFill: {},
      flatten: (style: any) => {
        if (Array.isArray(style)) {
          return Object.assign({}, ...style.filter(Boolean));
        }
        return style || {};
      },
    },
    View: (props: any) => React.createElement('View', props, props.children),
    Text: (props: any) => React.createElement('Text', props, props.children),
    TouchableOpacity: (props: any) =>
      React.createElement('TouchableOpacity', props, props.children),
    ActivityIndicator: (props: any) =>
      React.createElement('ActivityIndicator', props),
    Modal: (props: any) => React.createElement('Modal', props, props.children),
    Animated: {
      View: (props: any) =>
        React.createElement('Animated.View', props, props.children),
      Value: jest.fn().mockImplementation(() => mockAnimatedValue()),
      spring: jest.fn().mockReturnValue({ start: jest.fn() }),
      timing: jest.fn().mockReturnValue({ start: jest.fn() }),
      loop: jest.fn().mockReturnValue({ start: jest.fn(), stop: jest.fn() }),
      sequence: jest.fn().mockReturnValue({ start: jest.fn() }),
      parallel: jest.fn().mockReturnValue({ start: jest.fn() }),
    },
  };
});

// ── Mock expo-secure-store ────────────────────────────────────────
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// ── Mock expo-haptics ─────────────────────────────────────────────
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
  },
}));

// ── Mock expo-blur ────────────────────────────────────────────────
jest.mock('expo-blur', () => {
  const React = require('react');
  return {
    BlurView: (props: any) =>
      React.createElement('BlurView', props, props.children),
  };
});

// ── Mock expo-linear-gradient ─────────────────────────────────────
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: (props: any) =>
      React.createElement('LinearGradient', props, props.children),
  };
});

// ── Mock expo-image ───────────────────────────────────────────────
jest.mock('expo-image', () => {
  const React = require('react');
  return {
    Image: (props: any) => React.createElement('ExpoImage', props),
  };
});

// ── Mock expo-constants ───────────────────────────────────────────
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

// ── Mock lucide-react-native ──────────────────────────────────────
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const createIcon = (name: string) => (props: any) =>
    React.createElement(name, props);
  return {
    Lock: createIcon('Lock'),
    MoreHorizontal: createIcon('MoreHorizontal'),
    ChevronRight: createIcon('ChevronRight'),
    Clock: createIcon('Clock'),
    AlertTriangle: createIcon('AlertTriangle'),
  };
});

// ── Mock __DEV__ ──────────────────────────────────────────────────
(global as any).__DEV__ = true;

// ── Cleanup ───────────────────────────────────────────────────────
afterEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  jest.restoreAllMocks();
});
