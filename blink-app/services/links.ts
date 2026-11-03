import Constants from 'expo-constants';
import { API_URL } from '@/services/api';

/** The domain invite links live on (app.config.ts extra.linkDomain). */
export const LINK_DOMAIN = (
  (Constants.expoConfig?.extra?.linkDomain as string | undefined) ?? 'blink.app'
).toLowerCase();

/** The link a member shares to invite someone: opens the app at join-group. */
export function inviteLinkFor(inviteCode: string): string {
  return `https://${LINK_DOMAIN}/join/${inviteCode}`;
}

/** The server's legal pages (blink-server serves /privacy and /terms). */
export const LEGAL_URLS = {
  privacy: `${API_URL.replace(/\/api$/, '')}/privacy`,
  terms: `${API_URL.replace(/\/api$/, '')}/terms`,
};
