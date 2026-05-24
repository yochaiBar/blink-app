# Blink — To Do

> **Canonical tracker has moved to the Obsidian vault.**
>
> Open work: `~/Documents/Obsidian Vault/Blink/Tasks/00 - Day-to-Day Tracker.md`
>
> Update there. This file keeps only the historical "fixed bugs" log below for `git blame` value.

---

## Bugs (Fixed — 2026-03-22)

- [x] Cooldown race window — added `pg_advisory_xact_lock` per group to serialize concurrent challenge creation
- [x] Demo group UUID leak to API — `demo_welcome_crew` was sent to real endpoints, causing Sentry errors. Added `isDemoGroup` filter in feed screen.
- [x] Push notifications don't navigate — added routing for all notification types + push on challenge completion
- [x] Profile photo not saved — added `POST /upload/avatar-presign` endpoint + full upload→S3→save→cache-invalidate flow
- [x] Member avatar tap no feedback — fixed tooltip positioning above avatar, fade animation, auto-dismiss after 2s
- [x] Responded count starts at 0 for triggerer — show "Challenge started" state instead of inflating count
- [x] Bottom tab bar disappears — moved 8 screens into `(tabs)` layout groups so tab bar stays visible
- [x] Snap challenge expiration — added expiration check before starting camera for stale notification taps
- [x] Profile photo upload UX — added optimistic avatar display + spinner overlay during S3 upload

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
