/**
 * Notification Utility Tests - blink-app
 *
 * Tests the getNotificationRoute function which maps push notification
 * payloads to expo-router navigation targets.
 */

import './setup';

import { getNotificationRoute } from '../utils/notifications';

// Mock expo-notifications (module-level side effect in notifications.ts)
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[mock]' }),
  getDevicePushTokenAsync: jest.fn().mockResolvedValue({ data: 'device-token' }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id'),
  addNotificationReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  setBadgeCountAsync: jest.fn().mockResolvedValue(undefined),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'test-project-id' } } },
  easConfig: { projectId: 'test-project-id' },
}));

jest.mock('@/services/api', () => ({
  registerPushToken: jest.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────
// getNotificationRoute
// ─────────────────────────────────────────────────────────────────
describe('getNotificationRoute', () => {
  // ── Null / undefined inputs ────────────────────────────────────
  describe('invalid inputs', () => {
    it('should return null for undefined data', () => {
      expect(getNotificationRoute(undefined)).toBeNull();
    });

    it('should return null for empty object', () => {
      expect(getNotificationRoute({})).toBeNull();
    });

    it('should return null for data without type', () => {
      expect(getNotificationRoute({ groupId: 'g1' })).toBeNull();
    });

    it('should return null for unknown type', () => {
      expect(getNotificationRoute({ type: 'unknown_type' })).toBeNull();
    });
  });

  // ── challenge_started type ─────────────────────────────────────
  describe('challenge_started type', () => {
    it('should route to snap-challenge with groupId and challengeId', () => {
      const result = getNotificationRoute({
        type: 'challenge_started',
        groupId: 'g1',
        challengeId: 'c1',
      });
      expect(result).toEqual({
        pathname: '/snap-challenge',
        params: { groupId: 'g1', challengeId: 'c1' },
      });
    });

    it('should route to quiz-challenge for quiz challengeType', () => {
      const result = getNotificationRoute({
        type: 'challenge_started',
        groupId: 'g1',
        challengeId: 'c1',
        challengeType: 'quiz',
      });
      expect(result).toEqual({
        pathname: '/quiz-challenge',
        params: { groupId: 'g1', challengeId: 'c1' },
      });
    });

    it('should route to quiz-challenge for quiz_food type', () => {
      const result = getNotificationRoute({
        type: 'challenge_started',
        groupId: 'g1',
        challengeId: 'c1',
        challengeType: 'quiz_food',
      });
      expect(result).toEqual({
        pathname: '/quiz-challenge',
        params: { groupId: 'g1', challengeId: 'c1' },
      });
    });

    it('should route to quiz-challenge for quiz_most_likely type', () => {
      const result = getNotificationRoute({
        type: 'challenge_started',
        groupId: 'g1',
        challengeId: 'c1',
        challengeType: 'quiz_most_likely',
      });
      expect(result).toEqual({
        pathname: '/quiz-challenge',
        params: { groupId: 'g1', challengeId: 'c1' },
      });
    });

    it('should route to quiz-challenge for quiz_rate_day type', () => {
      const result = getNotificationRoute({
        type: 'challenge_started',
        groupId: 'g1',
        challengeId: 'c1',
        challengeType: 'quiz_rate_day',
      });
      expect(result).toEqual({
        pathname: '/quiz-challenge',
        params: { groupId: 'g1', challengeId: 'c1' },
      });
    });

    it('should fallback to group-detail with only groupId', () => {
      const result = getNotificationRoute({
        type: 'challenge_started',
        groupId: 'g1',
      });
      expect(result).toEqual({
        pathname: '/group-detail',
        params: { id: 'g1' },
      });
    });

    it('should return null with no groupId or challengeId', () => {
      const result = getNotificationRoute({ type: 'challenge_started' });
      expect(result).toBeNull();
    });
  });

  // ── challenge type ─────────────────────────────────────────────
  describe('challenge type', () => {
    it('should route to snap-challenge with groupId and challengeId', () => {
      const result = getNotificationRoute({
        type: 'challenge',
        groupId: 'g1',
        challengeId: 'c1',
      });
      expect(result).toEqual({
        pathname: '/snap-challenge',
        params: { groupId: 'g1', challengeId: 'c1' },
      });
    });

    it('should route to quiz-challenge for quiz type', () => {
      const result = getNotificationRoute({
        type: 'challenge',
        groupId: 'g1',
        challengeId: 'c1',
        challengeType: 'quiz',
      });
      expect(result).toEqual({
        pathname: '/quiz-challenge',
        params: { groupId: 'g1', challengeId: 'c1' },
      });
    });

    it('should fallback to group-detail with only groupId', () => {
      const result = getNotificationRoute({
        type: 'challenge',
        groupId: 'g1',
      });
      expect(result).toEqual({
        pathname: '/group-detail',
        params: { id: 'g1' },
      });
    });
  });

  // ── screen-based routing (alternative payload format) ──────────
  describe('screen-based routing', () => {
    it('should route to snap-challenge for screen=challenge', () => {
      const result = getNotificationRoute({
        type: 'some_other_type',
        screen: 'challenge',
        groupId: 'g1',
        challengeId: 'c1',
      });
      expect(result).toEqual({
        pathname: '/snap-challenge',
        params: { groupId: 'g1', challengeId: 'c1' },
      });
    });

    it('should route to quiz-challenge for screen=challenge with quiz type', () => {
      const result = getNotificationRoute({
        type: 'some_other_type',
        screen: 'challenge',
        groupId: 'g1',
        challengeId: 'c1',
        challengeType: 'quiz_most_likely',
      });
      expect(result).toEqual({
        pathname: '/quiz-challenge',
        params: { groupId: 'g1', challengeId: 'c1' },
      });
    });

    it('should not route screen=challenge without groupId', () => {
      const result = getNotificationRoute({
        type: 'some_other_type',
        screen: 'challenge',
        challengeId: 'c1',
      });
      // Falls through to default switch which returns null for unknown type
      expect(result).toBeNull();
    });
  });

  // ── group type ─────────────────────────────────────────────────
  describe('group type', () => {
    it('should route to group-detail with groupId', () => {
      const result = getNotificationRoute({
        type: 'group',
        groupId: 'g1',
      });
      expect(result).toEqual({
        pathname: '/group-detail',
        params: { id: 'g1' },
      });
    });

    it('should return null without groupId', () => {
      const result = getNotificationRoute({ type: 'group' });
      expect(result).toBeNull();
    });
  });

  // ── reaction type ──────────────────────────────────────────────
  describe('reaction type', () => {
    it('should route to group-detail with groupId', () => {
      const result = getNotificationRoute({
        type: 'reaction',
        groupId: 'g1',
      });
      expect(result).toEqual({
        pathname: '/group-detail',
        params: { id: 'g1' },
      });
    });

    it('should route to home when no groupId', () => {
      const result = getNotificationRoute({ type: 'reaction' });
      expect(result).toEqual({ pathname: '/' });
    });
  });
});
