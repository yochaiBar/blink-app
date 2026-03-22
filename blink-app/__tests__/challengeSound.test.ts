/**
 * Challenge Sound Tests - blink-app
 *
 * Tests for the challenge ringtone utility (Bug #7)
 * and dedup logic for suppressing duplicate push banners.
 */

import './setup';

import { playChallengeRing, wasRecentChallengeRing } from '@/utils/challengeSound';
import * as Haptics from 'expo-haptics';

describe('challengeSound', () => {
  describe('playChallengeRing', () => {
    it('should skip haptics and notifications on web platform', async () => {
      // Platform.OS is mocked as 'web' in setup.ts
      await playChallengeRing();
      expect(Haptics.impactAsync).not.toHaveBeenCalled();
    });
  });

  describe('wasRecentChallengeRing', () => {
    it('should return false when no ring has been played', () => {
      expect(wasRecentChallengeRing()).toBe(false);
    });

    it('should return false initially (web platform does not set timestamp)', async () => {
      await playChallengeRing();
      // On web, playChallengeRing returns early without setting timestamp
      expect(wasRecentChallengeRing()).toBe(false);
    });
  });
});
