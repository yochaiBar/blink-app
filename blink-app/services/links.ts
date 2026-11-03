import Constants from 'expo-constants';
import { API_URL } from '@/services/api';

const extra = Constants.expoConfig?.extra as { linkDomain?: string; supportEmail?: string } | undefined;

/**
 * The domain invite links live on (app.config.ts extra.linkDomain): by
 * default the API's own host, which serves the app-link files and the
 * /join/CODE landing page.
 */
export const LINK_DOMAIN = (extra?.linkDomain ?? new URL(API_URL).hostname).toLowerCase();

/** The link a member shares to invite someone: opens the app at join-group. */
export function inviteLinkFor(inviteCode: string): string {
  return `https://${LINK_DOMAIN}/join/${inviteCode}`;
}

/** Where "Contact Support" writes to (EXPO_PUBLIC_SUPPORT_EMAIL); null hides those rows. */
export const SUPPORT_EMAIL: string | null = extra?.supportEmail || null;

/** The server's legal pages (blink-server serves /privacy and /terms). */
export const LEGAL_URLS = {
  privacy: `${API_URL.replace(/\/api$/, '')}/privacy`,
  terms: `${API_URL.replace(/\/api$/, '')}/terms`,
};
