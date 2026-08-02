# Invite link deep-linking (`https://blink.app/join/CODE`)

The app is already configured to catch invite links:
- iOS: `associatedDomains: ['applinks:blink.app']` (`app.config.ts`)
- Android: `intentFilters` for host `blink.app`, path prefix `/join`, `autoVerify: true`
- Router: `app/_layout.tsx` parses `join/CODE` and pushes `/join-group` with the code

For the **tappable link to open the app**, `blink.app` must serve two association
files. Until then, invites still work via the **code** (share sheet includes it,
and the Join screen now accepts a pasted link *or* code).

## What to host on blink.app

Both files must be reachable over **HTTPS**, with **no redirect**, `Content-Type: application/json`:

| File | URL it must be served at |
|------|--------------------------|
| `apple-app-site-association` | `https://blink.app/.well-known/apple-app-site-association` |
| `assetlinks.json`            | `https://blink.app/.well-known/assetlinks.json` |

> The Apple file has **no extension** and must NOT be served as `...aasa.json`.

## Fill in the placeholders first

1. **`REPLACE_WITH_APPLE_TEAM_ID`** — your 10-char Apple Team ID.
   - `eas credentials` → iOS, or Apple Developer portal → Membership.
   - Final appID looks like `A1B2C3D4E5.com.yochaibar.blinks`.
2. **`REPLACE_WITH_ANDROID_SIGNING_SHA256`** — SHA-256 of the signing cert.
   - `eas credentials` → Android → shows the fingerprint, **or**
   - Play Console → your app → Test and release → App integrity → App signing → SHA-256.
   - Format: colon-separated hex, e.g. `AB:CD:EF:...`.

## Verify after hosting
- iOS: `curl -v https://blink.app/.well-known/apple-app-site-association` (200, JSON, no redirect).
- Android: `https://developers.google.com/digital-asset-links/tools/generator`.
- Apple CDN caches AASA — allow time / bump build after first publish.

## Note on Expo Go
Universal / App Links **do not work in Expo Go** — only in a Dev Client,
TestFlight, or a production build. Test the tappable link there, not in Expo Go.
