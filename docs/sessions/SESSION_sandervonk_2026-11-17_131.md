# Work session

User: sandervonk
Date: 2026-11-17
Workstream: ios-quality-audit
Agent: Claude (Opus lead, Sonnet reviewers and fixers)
Status: handoff

## Summary

Independent quality audit and hardening of the recently merged iOS work (calendar conflicts and one-tap add, Profile > Notifications incl. Email, push registration, iPhone Duo, weekly themes on Home, onboarding, invitations, album, photo comments and chat). Five read-only Sonnet reviews produced about 120 findings; the lead triaged them and three Sonnet fixers worked on disjoint file sets in this worktree with a shared, lock-serialized build (`/tmp/dip-sim-lock`). Phase 1 (this log's first PR) fixes correctness, privacy and performance defects without intended visual changes. Phase 2 (accessibility at AX sizes, contrast and visible polish) follows in a second PR. Findings and fix status: docs/quality/ios-audit-2026-11.md (added with phase 2).

## Changes

Phase 1 (`quality/ios-audit-hardening`, first commit):
- Calendar: stale "Added" reconciled with the device, Undo reports a failed removal, editor presentation can no longer hang, Challenge pill double-present guard, conflicts awaited before deciding, own entry excluded by identifier as well as URL, all-day detection correct on DST days, EventKit reads off the main actor with a debounced change observer, re-add adopts an existing DIP entry (no duplicates), "Leave and remove from calendar" only after a confirmed leave, pill VoiceOver label carries the visible date, toast 10 s under VoiceOver, conflict copy shows day/All day, model `invalidate()`.
- Push and session: pending unregister bound to its uid, FCM token deletion retried while signed out, register/sign-out serialized, permission revoked in Settings unregisters, one session-end hook in `DIPApp` (push cleanup, link inbox, calendar records, bug-report queue, Debug tour record, cached home models), APNs token forwarded explicitly (flag-gated), deep-link ids restricted to `[A-Za-z0-9_-]{1,128}`, Release ignores launch flags (`MockLaunch.Flags`).
- Notification settings: queued offline writes no longer revert, load no longer clobbers in-flight toggles, Email section reachable when push is off (new Profile row "Notifications" in mock/unflagged builds).
- Accounts/onboarding/invites/profile: `retryMembership` no longer sticks on "Finding your company", interests save cannot be broken by Back, success haptic after the hold, stray tasks cancelled, home models built once per scope, "Already answered" invite state, discard confirmation for dirty profile edits.
- Duo/Home/album/chat: hinge latch and open/close hysteresis, Duo default event matches Home ordering, no placeholder flash, route dedupe on rapid taps, concurrent pull-to-refresh, photo import limited to 2 at a time, timed-out Firestore writes treated as pending, chat 1000-character composer limit, off-main cached image decoding, album share uses the event link, album listener only for past events.
- Lead review changes: kept the reviewed `AccountsSession.signOut` semantics (a fixer had changed them; reverted, only `retryMembership` fixed); cached home models are evicted on real session end only, not on `onDisappear`.

## Validation

All through `scratchpad/dipbuild.sh` (lock-serialized xcodebuild / swift test, simulator Claude-Base):
- `swift test` DIPCore `Calendar` (72 passed), `DIPNotificationSettingsModelTests|DIPShareLinkTests` (passed), `Challenge` (41 passed); DIPAccounts all (25 passed); DIPDesignSystem `MessageComposerStateTests` (passed).
- `xcodebuild test` DIPTests: CalendarModelTests, PushRegistrarTests, DuoLayoutTests, OnboardingTourModelTests, ChatSourceTests, AlbumUploadQueueTests (70 tests, 0 failures, after the lead's changes); earlier fixer runs of NotificationDocumentMapperTests, AccountsStageTests, AccountsOnboardingTests, MemberEventAppRepositoryTests, MemberParticipationTests, LiveMemberEventReadTests, AlbumPolishTests, MemberAlbumTests (0 failures).
- `xcodebuild build` DIP: succeeded.
- Visual regression (regular iPhone, `--mock-member`, baseline origin/main vs branch, pixel diff): no unexpected change; only the new Profile "Notifications" row (intended, PUSH-Q6). Duo smoke on Claude-Duo renders the two-pane shell.
- Not run: full suites (by owner policy), device push, live Firestore offline behavior.

## Decisions

- Optimistic Join keeps a single tap haptic (bar commit); the extra optimistic success haptic was dropped for Join only.
- CAL-Q8 (EventKit all-day end inclusive or exclusive) left unchanged and unverified.
- Invite `requestId` for respond not added: the contract has no such field.

## Handoff

Phase 2 (accessibility, contrast, visible polish, launch time) and the findings doc land in the second PR of this session. Owner items are listed in docs/quality/ios-audit-2026-11.md.
