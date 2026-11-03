# Invite links (`https://<link domain>/join/CODE`)

A member shares `https://<link domain>/join/CODE`. With the app installed, the
OS opens it in Blinks; without it, the link shows a landing page with an
**Open in Blinks** button (`blink://join/CODE`) and, if configured, a
get-the-app link.

The **link domain defaults to the API's own host** (the host of
`EXPO_PUBLIC_API_URL`), because that server serves everything the link needs.
Set `EXPO_PUBLIC_LINK_DOMAIN` only to move links to another domain you
control, and serve the same routes there.

## App (`blink-app`)

| Setting                     | Where                    | Effect                                                    |
| --------------------------- | ------------------------ | --------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`       | `eas.json` build profile | API URL; its host is the default link domain              |
| `EXPO_PUBLIC_LINK_DOMAIN`   | `eas.json` (optional)    | Overrides the link domain                                 |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | `eas.json` (optional)    | "Contact Support" in Settings and Help; hidden when unset |

`app.config.ts` derives from the link domain:

- iOS `associatedDomains: ['applinks:<domain>']`;
- the Android `intentFilters` (host, `/join`, `autoVerify`);
- the expo-router origin, and `extra.linkDomain` (`services/links.ts` builds the shared links).

Links are handled **only** in `app/+native-intent.tsx`:

- it accepts `blink://join/CODE` and `https://<link domain>/join/CODE`, nothing else;
- the code becomes a pending invite;
- `hooks/useInviteReplay.ts` opens the join screen once the user is signed in and past onboarding, so a link tapped before login still works.

## Server (`blink-server`)

| Route                                         | Env                                                                      | Notes                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `GET /.well-known/apple-app-site-association` | `APPLE_TEAM_ID` (`RW54G9U2AP`), `IOS_BUNDLE_ID` (`com.yochaibar.blinks`) | appID `TEAM.BUNDLE`, path `/join/*`; 404 until both are set                      |
| `GET /.well-known/assetlinks.json`            | `ANDROID_PACKAGE`, `ANDROID_CERT_SHA256` (comma-separated)               | 404 until set                                                                    |
| `GET /join/:code`                             | `APP_DOWNLOAD_URL` (optional)                                            | Landing page for people without the app; codes are validated, all output escaped |

Both `.well-known` files are JSON over HTTPS with no redirect, as iOS and
Android require. The Android signing fingerprint comes from
`eas credentials` → Android, or from Play Console → App integrity → App signing.

## Verify

- iOS: `curl -v https://<link domain>/.well-known/apple-app-site-association` should return 200 JSON. Apple's CDN caches it, so give it time after the first deploy.
- Android: use Google's Digital Asset Links tool against `https://<link domain>/.well-known/assetlinks.json`.
- Universal links and App Links **don't work in Expo Go**. Test in a dev client, TestFlight or a production build.
