/**
 * Time Utility Tests - blink-app
 *
 * Tests all functions exported from utils/time.ts:
 * - getRelativeTime
 * - getRelativeTimeShort
 * - generateId
 * - generateInviteCode
 * - formatChallengeTime
 * - isChallengeActive
 * - getTimeGreeting
 */

import './setup';

import {
  getRelativeTime,
  getRelativeTimeShort,
  generateId,
  generateInviteCode,
  formatChallengeTime,
  isChallengeActive,
  getTimeGreeting,
} from '../utils/time';

// ─────────────────────────────────────────────────────────────────
// getRelativeTime
// ─────────────────────────────────────────────────────────────────
describe('getRelativeTime', () => {
  it('should return "just now" for dates less than 10 seconds ago', () => {
    const now = new Date();
    expect(getRelativeTime(now)).toBe('just now');
    expect(getRelativeTime(new Date(Date.now() - 5000))).toBe('just now');
  });

  it('should return seconds ago for 10-59 seconds', () => {
    const date = new Date(Date.now() - 30 * 1000);
    expect(getRelativeTime(date)).toBe('30s ago');
  });

  it('should return minutes ago for 1-59 minutes', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    expect(getRelativeTime(date)).toBe('5m ago');
  });

  it('should return hours ago for 1-23 hours', () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(getRelativeTime(date)).toBe('3h ago');
  });

  it('should return days ago for 1-6 days', () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(getRelativeTime(date)).toBe('2d ago');
  });

  it('should return weeks ago for 1-3 weeks', () => {
    const date = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    expect(getRelativeTime(date)).toBe('2w ago');
  });

  it('should return formatted date for older than 4 weeks', () => {
    const date = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const result = getRelativeTime(date);
    // Should be a locale-formatted date like "Jan 11"
    expect(result).toMatch(/[A-Z][a-z]{2}\s\d{1,2}/);
  });

  it('should return "just now" for future dates', () => {
    const future = new Date(Date.now() + 60000);
    expect(getRelativeTime(future)).toBe('just now');
  });

  it('should accept string date input', () => {
    const now = new Date().toISOString();
    expect(getRelativeTime(now)).toBe('just now');
  });

  it('should accept numeric timestamp input', () => {
    const now = Date.now();
    expect(getRelativeTime(now)).toBe('just now');
  });

  it('should handle exactly 60 seconds as 1m ago', () => {
    const date = new Date(Date.now() - 60 * 1000);
    expect(getRelativeTime(date)).toBe('1m ago');
  });

  it('should handle exactly 24 hours as 1d ago', () => {
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(getRelativeTime(date)).toBe('1d ago');
  });
});

// ─────────────────────────────────────────────────────────────────
// getRelativeTimeShort
// ─────────────────────────────────────────────────────────────────
describe('getRelativeTimeShort', () => {
  it('should return "now" for dates less than 60 seconds ago', () => {
    expect(getRelativeTimeShort(new Date())).toBe('now');
    expect(getRelativeTimeShort(new Date(Date.now() - 30000))).toBe('now');
  });

  it('should return minutes for 1-59 minutes', () => {
    const date = new Date(Date.now() - 10 * 60 * 1000);
    expect(getRelativeTimeShort(date)).toBe('10m');
  });

  it('should return hours for 1-23 hours', () => {
    const date = new Date(Date.now() - 5 * 60 * 60 * 1000);
    expect(getRelativeTimeShort(date)).toBe('5h');
  });

  it('should return days for 24+ hours', () => {
    const date = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(getRelativeTimeShort(date)).toBe('3d');
  });

  it('should return "now" for future dates', () => {
    const future = new Date(Date.now() + 60000);
    expect(getRelativeTimeShort(future)).toBe('now');
  });
});

// ─────────────────────────────────────────────────────────────────
// generateId
// ─────────────────────────────────────────────────────────────────
describe('generateId', () => {
  it('should generate an id with default prefix', () => {
    const id = generateId();
    expect(id).toMatch(/^id_\d+_[a-z0-9]+$/);
  });

  it('should generate an id with custom prefix', () => {
    const id = generateId('msg');
    expect(id.startsWith('msg_')).toBe(true);
  });

  it('should generate unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────
// generateInviteCode
// ─────────────────────────────────────────────────────────────────
describe('generateInviteCode', () => {
  it('should generate a 6-character code by default', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(6);
  });

  it('should generate a code of specified length', () => {
    const code = generateInviteCode(8);
    expect(code).toHaveLength(8);
  });

  it('should only contain allowed characters (no ambiguous chars)', () => {
    // Excludes I, O, 0, 1 to avoid ambiguity
    const allowed = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;
    for (let i = 0; i < 50; i++) {
      expect(generateInviteCode()).toMatch(allowed);
    }
  });

  it('should generate unique codes', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateInviteCode()));
    // With 31^6 possibilities, collisions are extremely unlikely
    expect(codes.size).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────
// formatChallengeTime
// ─────────────────────────────────────────────────────────────────
describe('formatChallengeTime', () => {
  it('should format remaining time as M:SS', () => {
    const endTime = Date.now() + 90000; // 1:30 remaining
    expect(formatChallengeTime(endTime)).toBe('1:30');
  });

  it('should show 0:00 for past end times', () => {
    const endTime = Date.now() - 10000;
    expect(formatChallengeTime(endTime)).toBe('0:00');
  });

  it('should pad seconds with leading zero', () => {
    const endTime = Date.now() + 65000; // ~1:05
    const result = formatChallengeTime(endTime);
    expect(result).toMatch(/^\d+:\d{2}$/);
  });

  it('should handle exactly 0 remaining', () => {
    const endTime = Date.now();
    expect(formatChallengeTime(endTime)).toBe('0:00');
  });
});

// ─────────────────────────────────────────────────────────────────
// isChallengeActive
// ─────────────────────────────────────────────────────────────────
describe('isChallengeActive', () => {
  it('should return true for future end time', () => {
    expect(isChallengeActive(Date.now() + 60000)).toBe(true);
  });

  it('should return false for past end time', () => {
    expect(isChallengeActive(Date.now() - 60000)).toBe(false);
  });

  it('should return false for undefined end time', () => {
    expect(isChallengeActive(undefined)).toBe(false);
  });

  it('should return false for 0', () => {
    expect(isChallengeActive(0)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// getTimeGreeting
// ─────────────────────────────────────────────────────────────────
describe('getTimeGreeting', () => {
  const RealDate = global.Date;

  afterEach(() => {
    global.Date = RealDate;
  });

  function mockHour(hour: number) {
    const OrigDate = RealDate;
    // Create a subclass that overrides no-arg constructor to return a fixed hour
    class MockDate extends OrigDate {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super();
          this.setHours(hour, 0, 0, 0);
        } else {
          super(...(args as [any]));
        }
      }
    }
    global.Date = MockDate as any;
    // Preserve static methods
    global.Date.now = OrigDate.now;
  }

  it('should return night owl for late night (0-4)', () => {
    mockHour(2);
    const result = getTimeGreeting();
    expect(result.text).toBe('Night owl');
  });

  it('should return good morning for morning (5-11)', () => {
    mockHour(9);
    const result = getTimeGreeting();
    expect(result.text).toBe('Good morning');
  });

  it('should return good afternoon for afternoon (12-16)', () => {
    mockHour(14);
    const result = getTimeGreeting();
    expect(result.text).toBe('Good afternoon');
  });

  it('should return good evening for evening (17-20)', () => {
    mockHour(19);
    const result = getTimeGreeting();
    expect(result.text).toBe('Good evening');
  });

  it('should return night owl for late evening (21-23)', () => {
    mockHour(22);
    const result = getTimeGreeting();
    expect(result.text).toBe('Night owl');
  });

  it('should always include an emoji', () => {
    const result = getTimeGreeting();
    expect(result.emoji).toBeTruthy();
    expect(typeof result.emoji).toBe('string');
  });
});
