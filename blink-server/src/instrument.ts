import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';

// Must be the first import of server.ts: loads .env before anything parses
// it, and initializes Sentry before the app modules are required.
dotenv.config();

import { env } from './config/env';

// Initialize Sentry before anything else.
//
// Privacy hardening (Plan C1): request bodies for sensitive routes contain
// ciphertext or near-ciphertext metadata that must never reach Sentry's
// servers. `sendDefaultPii: false` suppresses headers and IPs but does NOT
// strip `event.request.data`. We add a `beforeSend` that nulls the body for
// every event — broad-brush by design. If we later want body capture on
// some endpoints, allowlist them explicitly here.
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.2,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        // Drop the body entirely — we never need it to diagnose, and on the
        // photo relay path it carries ciphertext. Defense in depth even on
        // routes that aren't crypto-sensitive.
        event.request.data = undefined;
        // Cookies are off via sendDefaultPii, but belt-and-suspenders.
        event.request.cookies = undefined;
      }
      // Strip any breadcrumb that looks like an HTTP body capture.
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => {
          if (b.data && 'body' in b.data) {
            return { ...b, data: { ...b.data, body: undefined } };
          }
          return b;
        });
      }
      return event;
    },
  });
}
