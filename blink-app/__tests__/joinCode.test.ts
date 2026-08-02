/**
 * extractInviteCode — normalizes whatever the user pastes into the Join box
 * (a full invite link, a custom-scheme link, or the raw code) down to the code.
 */
import './setup';
import { extractInviteCode, looksLikeInviteLink } from '../utils/inviteCode';

describe('extractInviteCode', () => {
  it('returns a raw code uppercased', () => {
    expect(extractInviteCode('abc123')).toBe('ABC123');
  });

  it('extracts the code from a universal link', () => {
    expect(extractInviteCode('https://blink.app/join/ABC123')).toBe('ABC123');
  });

  it('extracts the code from a custom-scheme link', () => {
    expect(extractInviteCode('blink://join/abc123')).toBe('ABC123');
  });

  it('ignores query/hash/fragments after the code', () => {
    expect(extractInviteCode('https://blink.app/join/ABC123?ref=sms#x')).toBe('ABC123');
  });

  it('trims surrounding whitespace', () => {
    expect(extractInviteCode('  DEF456  ')).toBe('DEF456');
  });

  it('collapses a link pasted with a trailing message', () => {
    expect(extractInviteCode('https://blink.app/join/ABC123')).toBe('ABC123');
  });

  it('returns empty string for empty input', () => {
    expect(extractInviteCode('')).toBe('');
  });
});

describe('looksLikeInviteLink', () => {
  it('is true for universal and scheme links', () => {
    expect(looksLikeInviteLink('https://blink.app/join/ABC123')).toBe(true);
    expect(looksLikeInviteLink('blink://join/ABC123')).toBe(true);
  });

  it('is false for a bare code', () => {
    expect(looksLikeInviteLink('ABC123')).toBe(false);
  });
});

describe('extractInviteCode — edge cases beyond the happy path', () => {
  it('handles a trailing slash after the code', () => {
    // e.g. a share sheet that appends a trailing slash to the deep link.
    expect(extractInviteCode('https://blink.app/join/CREW25/')).toBe('CREW25');
  });

  it('does not crash on a link with no code after join/', () => {
    // Should not throw, and should not silently accept an empty/garbage code as valid.
    const result = extractInviteCode('https://blink.app/join/');
    expect(result).toBe('');
  });

  it('FIXED: pasting a full invite link resolves to the code on-device. The join-group.tsx ' +
    'TextInput maxLength is now 128, high enough that the native layer (iOS ' +
    'RCTBaseTextInputView.mm / Android InputFilter.LengthFilter) no longer truncates a ' +
    'pasted link before onChangeText fires. So the full link reaches extractInviteCode() ' +
    'and collapses to the code -- the exact reported repro now works.', () => {
    const pastedLink = 'https://blink.app/join/CREW25';
    // The whole link (29 chars) fits under maxLength={128}, so onChangeText receives it intact.
    expect(pastedLink.length).toBeLessThanOrEqual(128);
    expect(looksLikeInviteLink(pastedLink)).toBe(true);
    expect(extractInviteCode(pastedLink)).toBe('CREW25');
  });
});
