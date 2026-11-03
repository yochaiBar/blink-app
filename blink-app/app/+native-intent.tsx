import { LINK_DOMAIN } from '@/services/links';
import { usePendingInvite } from '@/stores/pendingInviteStore';
import { parseInviteLink } from '@/utils/inviteCode';

/**
 * Every URL that opens the app passes through here first (expo-router). An
 * invite link — blink://join/CODE or https://<link domain>/join/CODE — is
 * kept as a pending invite, and AuthGate opens it once the user is signed in
 * (after login, if they weren't). This is the only place links are handled.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const code = parseInviteLink(path, [LINK_DOMAIN]);
  if (code) usePendingInvite.getState().setCode(code);
  return '/';
}
