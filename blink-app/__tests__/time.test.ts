/**
 * Time Utility Tests - blink-app
 *
 * Tests getRelativeTime, the only export of utils/time.ts.
 */

import './setup';

import { getRelativeTime } from '../utils/time';

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
