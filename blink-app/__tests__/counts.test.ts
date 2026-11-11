/**
 * counts — numbers shown to users: plurals and "who answered" summaries.
 */

import './setup';

import { plural, respondedSummary, streakLabel } from '../utils/counts';

describe('plural', () => {
  it('uses the singular for exactly one', () => {
    expect(plural(1, 'member')).toBe('1 member');
    expect(plural(0, 'member')).toBe('0 members');
    expect(plural(6, 'member')).toBe('6 members');
  });
});

describe('respondedSummary', () => {
  it("counts members who answered out of the group's members, and doesn't count you until you answer", () => {
    expect(respondedSummary(['me', 'dana'], new Set(['dana']))).toBe('1/2 responded');
    expect(respondedSummary(['me', 'dana'], new Set(['dana', 'me']))).toBe('2/2 responded');
  });

  it('matches the member count shown elsewhere (no extra slot for the viewer)', () => {
    const crew = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(respondedSummary(crew, new Set(['a', 'b', 'c', 'd', 'stranger']))).toBe('4/6 responded');
  });
});

describe('streakLabel', () => {
  it('says streaks count challenges, not days', () => {
    expect(streakLabel(1)).toBe('1-challenge streak');
    expect(streakLabel(7)).toBe('7-challenge streak');
  });
});
