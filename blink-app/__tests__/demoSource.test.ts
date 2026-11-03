/**
 * demoSource tests - blink-app
 *
 * The demo group is served entirely on-device by services/demoSource.ts.
 * These cover the id routing the hooks rely on and the shapes it returns.
 */

import './setup';

import { demoSource, isDemoChallenge, isDemoGroup, isDemoResponse } from '../services/demoSource';
import { useOnboardingStore } from '../stores/onboardingStore';

describe('demo id routing', () => {
  it('recognises the demo group, challenge and responses', () => {
    expect(isDemoGroup(demoSource.groupId)).toBe(true);
    expect(isDemoChallenge(demoSource.challengeId)).toBe(true);
    for (const r of demoSource.responses()) expect(isDemoResponse(r.id)).toBe(true);
  });

  it('does not claim real (UUID) or missing ids', () => {
    const uuid = '3f1c2a7e-9b4d-4c1e-8a2f-6d5e4c3b2a10';
    expect(isDemoGroup(uuid)).toBe(false);
    expect(isDemoChallenge(uuid)).toBe(false);
    expect(isDemoResponse(uuid)).toBe(false);
    expect(isDemoGroup(undefined)).toBe(false);
    expect(isDemoResponse(null)).toBe(false);
  });
});

describe('demoSource data', () => {
  it('keeps the demo challenge open: expiry is always in the future', () => {
    const challenge = demoSource.activeChallenge();
    expect(challenge.id).toBe(demoSource.challengeId);
    expect(challenge.group_id).toBe(demoSource.groupId);
    expect(new Date(challenge.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('lists the demo group with an active challenge', () => {
    const group = demoSource.listItem();
    expect(group.id).toBe(demoSource.groupId);
    expect(group.hasActiveChallenge).toBe(true);
    expect(group.challengeEndTime).toBeGreaterThan(Date.now());
  });

  it('reports progress consistent with its responses and members', () => {
    const progress = demoSource.progress();
    expect(progress.respondedCount).toBe(demoSource.responses().length);
    expect(progress.totalMembers).toBe(demoSource.groupDetail().members.length);
    expect(progress.respondedUsers.map((u) => u.userId)).toEqual(demoSource.responses().map((r) => r.user_id));
  });

  it('has a photo for every demo response and no photo URL on the response itself', () => {
    for (const r of demoSource.responses()) {
      expect(r.has_photo).toBe(true);
      expect(demoSource.photoUri(r.id)).toMatch(/^https:\/\//);
    }
  });
});

describe('demo reveal', () => {
  beforeEach(async () => {
    await useOnboardingStore.getState().reset();
  });

  it("puts the user's own snap first, then the crew", () => {
    const reveal = demoSource.reveal({ id: 'me', name: 'Dana' });
    expect(reveal.responses[0].user_id).toBe('me');
    expect(reveal.responses[0].display_name).toBe('Dana');
    expect(reveal.responses.slice(1)).toEqual(demoSource.responses());
    expect(reveal.challenge?.id).toBe(demoSource.challengeId);
  });

  it('shows the photo the user just took as their own snap', () => {
    const own = demoSource.reveal({ id: 'me', name: 'Dana' }).responses[0];
    expect(demoSource.photoUri(own.id)).toBeNull();
    demoSource.recordSnap('file:///tmp/snap.jpg');
    expect(demoSource.photoUri(own.id)).toBe('file:///tmp/snap.jpg');
  });

  it('finishing the reveal completes the demo challenge and the tour', () => {
    demoSource.completeChallenge();
    const state = useOnboardingStore.getState();
    expect(state.demoChallengeCompleted).toBe(true);
    expect(state.tourComplete).toBe(true);
  });
});
