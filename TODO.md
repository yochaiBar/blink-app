# Blink — To Do List

> Last updated: 2026-03-21

---

## Bugs (Open)

- [ ] **Responded count starts at 0 for challenge triggerer** — When a user triggers a challenge, the responded count shows 0/N even though they're about to respond. Consider optimistic UI or auto-responding on trigger.
- [ ] **Advisory #5: Cooldown race window** — The 5-second challenge cooldown check has a narrow race window (no row lock on the cooldown SELECT itself). Low priority — mitigated by the transaction + FOR UPDATE on active challenges.
- [ ] **Push notifications don't navigate to relevant screen** — Tapping a notification should deep-link to the specific group/challenge, currently does nothing or goes to home.
- [ ] **Profile photo not saved after changing** — User can pick a new photo in the profile page but it doesn't persist after leaving the screen.
- [ ] **Member avatar tap doesn't show name** — In a group, pressing a member avatar should show who it is (name tooltip or profile preview). Currently no visible feedback.
- [ ] **Bottom tab bar disappears on some screens** — The bottom navigation should always be visible. It's hidden on certain screens where it shouldn't be.

## Bugs (Fixed — 2026-03-21)

- [x] AI commentary shows wrong response count (e.g., "3 responded" in 2-member group) — capped counts to current members
- [x] Quiz options show phone numbers instead of display names — fallback changed to 'Anonymous'
- [x] Quiz option text invisible when selected — text color was blending with selected background
- [x] Quiz results missing voter avatars — added mini avatar row per option bar

## Bugs (Fixed — 2026-03-20)

- [x] OTP screen invisible / input not showing — added placeholder dots + reduced focus delay
- [x] Onboarding popup flickering — added `isProcessing` ref guard + `requestAnimationFrame`
- [x] Emoji reaction feedback missing — added spring animation, coral selection ring, count badges
- [x] Dual challenge trigger race condition — wrapped in transaction + 5s cooldown + FOR UPDATE lock
- [x] Auto-close challenge when all respond — `checkChallengeCompletion` with member timing filter
- [x] Feed not syncing after response — added `groupId` to socket payload + 5 extra cache invalidations
- [x] Photo empty on reveal screen — pass `localPhotoUri` as fallback from nav params
- [x] Demo camera not working — removed short-circuit, navigate to real snap-challenge screen
- [x] Group stats card — new endpoint + component with top trigger, best streak, fastest responder
- [x] S3 key restructured — `users/{uid}/groups/{gid}/{cid}.jpg`
- [x] Name required on onboarding — guard against empty name + keyboard submit bypass
- [x] Challenge ringtone — local notification + haptic burst on `challenge:started` socket event
- [x] Ringtone plays for originator — skip `playChallengeRing()` when `created_by === user.id`
- [x] GroupStatsCard shows "Best Streak: 0" — added `streak > 0` guard
- [x] MemberAvatarRow count mismatch — fixed denominator to include current user
- [x] SnapCard reaction buttons missing selection state — aligned with challenge-reveal pattern

---

## Features — Next Up

### P0 — Ship Blockers
- [ ] **TestFlight build** — `eas build --platform ios --profile production`
- [ ] **Google Play closed testing** — internal track APK
- [ ] **App Store metadata** — screenshots, descriptions, keywords, categories
- [ ] **Submit to App Store + Google Play**

### P1 — Pre-Launch Polish
- [ ] **Analytics integration** — PostHog or Mixpanel for key events (challenge triggered, response submitted, group created, onboarding completed)
- [ ] **CI/CD pipeline** — GitHub Actions: lint + typecheck + test on PR, deploy on merge to main
- [ ] **Lower OTP rate limit** — `OTP_RATE_LIMIT_PER_HOUR` on Railway from 50 to 3 for production
- [ ] **Onboarding avatar upload** — let users set profile photo during onboarding
- [ ] **Feed tab scroll-to-top on re-tap** — When already on the feed page, tapping the feed tab again should scroll to the top of the list
- [ ] **Text responses to challenges/photos** — Allow users to respond with text to a challenge or a photo (design TBD — could be inline comment, reply bubble, or thread)

### P2 — Growth & Engagement
- [ ] **Invite flow improvements** — share invite link via native share sheet with preview card
- [ ] **Streak notifications** — remind users before their streak breaks
- [ ] **Challenge history gallery** — view past challenge photos in a grid
- [ ] **Group chat / comments** — text reactions on snaps beyond emoji
- [ ] **Custom challenge prompts** — let users write their own prompt challenges
- [ ] **Explore page** — discover public challenges, trending groups, or featured content (design TBD)
- [ ] **Group page redesign** — reorganize into card/box layout per group instead of a flat list (design TBD)

### P3 — Infrastructure
- [ ] **Local-only photo storage** — Store all photos on-device only (no cloud/S3). Remove S3 upload flow, use local filesystem or SQLite blob. Major architecture change — impacts upload, reveal, feed, and backup strategy.
- [ ] **OpenAPI spec** — auto-generate from Zod schemas for API documentation
- [ ] **80% test coverage** — currently at ~65%, add tests for untested hooks and components
- [ ] **E2E tests** — Maestro or Detox for critical user flows (onboarding, challenge, quiz)
- [ ] **Rate limiting audit** — review all public endpoints, add per-user throttling where missing
- [ ] **Database indexes audit** — check query plans for slow queries as data grows

---

## Infrastructure Status

| Service | Status | Notes |
|---------|--------|-------|
| Railway API | Live | `blink-api-production.up.railway.app` |
| Railway Postgres | Live | Auto-migrate on deploy |
| AWS S3 | Active | `blinks3upload` bucket, us-east-1 |
| Twilio SMS | Active | OTP working in production |
| Sentry | Active | Server + app crash reporting |
| Content Moderation | Active | AWS Rekognition |
| Expo/EAS | Active | Preview builds configured |

---

## Test Suite

| Package | Tests | Status |
|---------|-------|--------|
| blink-server | 188 | All passing |
| blink-app | 163 | All passing |
| **Total** | **351** | **All passing** |
