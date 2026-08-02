/**
 * Accept anything the user might paste into the Join box and reduce it to the
 * bare invite code:
 *   • a full universal link  → https://blink.app/join/ABC123
 *   • a custom-scheme link    → blink://join/ABC123
 *   • the raw code            → ABC123
 * Without this, pasting the shared *link* into the code box hits the server as a
 * bogus "code" and gets rejected — the exact "I shared the link, it doesn't work"
 * failure. We uppercase and strip anything after the code (query/hash/space).
 */
export function extractInviteCode(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/join\/([^/?#\s]+)/i);
  if (match) return match[1].trim().toUpperCase();
  // Looked like a link but had no code after "join/" (e.g. ".../join/") — treat
  // as no code rather than passing the whole URL through as a bogus code.
  if (looksLikeInviteLink(trimmed)) return '';
  return trimmed.toUpperCase();
}

/** True when a string looks like a pasted link rather than a bare code. */
export function looksLikeInviteLink(text: string): boolean {
  return /join\/|:\/\//i.test(text);
}
