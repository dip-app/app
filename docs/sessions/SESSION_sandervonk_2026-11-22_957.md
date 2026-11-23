# Work session

User: sandervonk
Date: 2026-11-22
Workstream: notification-followups
Agent: Claude (Opus), area owner for notification follow-ups
Status: completed

## Summary

Notification follow-ups for issues #204 and #214. (1) The weekly theme push and email reached only members and admins: the shared `FirestoreThemes` member pager skipped organizers. Docs (push catalog row 11) say "every active member of the company", so both now reach every active member of any role; invited and deactivated users stay out. (2) iOS Profile > Notifications > Email shows the opt-in `weekly_themes` row for everyone and `admin_digest` for admins only, both default off. (3) In-app notices written by the server now follow the recipient's language (en, es) where cheap; English is byte-identical. (4) Docs and runbooks updated. Nothing deployed, nothing uploaded.

## Changes

- Backend: `notifications/domain/audience.ts` (`isCompanyAudienceMember`), used by `infrastructure/firestoreThemes.ts` (push and email share the pager); `routerPorts.ts` doc.
- Backend i18n: `NotificationRequest.inAppFor` and `localizedInApp` in `application/router.ts`; builders in `handlers.ts` (change, cancel, reminder; localized "Activity update" fallback title), `newTriggers.ts` (invite answered), `socialTriggers.ts` (photo comment, photo added). `domain/notices.ts` for transactional notices: invite (`invites/domain/invitePolicy.ts`, `invites/application/sendInvite.ts`), attendee added (`admin/application/attendees.ts`), challenge approved (`submissions/application/submissionCommands.ts`). Push catalog keys `push.change.fallbackTitle`, `push.notice.*` (en, es).
- Tests: `gcp/tests/unit/weekly-theme-audience.test.ts`, `gcp/tests/unit/notification-text-i18n.test.ts`.
- iOS: `DIPNotificationCategory` gains `weeklyThemes`, `adminDigest` (email only, default off) and `summary(on:)` (Challenges on email: "Reviews of your weekly theme submissions"); `DIPNotificationSettingsModel` takes `isAdmin`, hides `adminDigest` from members, exposes `saveErrorChannel`/`saveErrorCategory`; screen shows a failed email save under its switch (push failures unchanged at the top); `DIPPrototypeApp`/`DIPMemberHome` pass `isAdmin` (`context.role == "admin"`), Debug flag `--notification-settings-admin`. String Catalog (DIPCore) en and es. Tests in DIPCoreTests, DIPPresentationTests and `DIPUITests/NotificationSettingsUITests`.
- Docs: push-catalog (audience, text language table), email-catalog, backend-i18n, CURRENT_STATE, email-runbook step 13, push-apns-runbook step 13.

## Validation

- `node --import tsx --test` (from gcp/functions) on weekly-theme-audience, notification-text-i18n, notifications-new-triggers, email-optin, push-i18n, notificationEmailPayloads, invites, challenge-submissions, admin-events, admin-members and `tests/unit/notification*.test.ts`: all pass (35 + 185 + 51 tests across the runs, 0 failures).
- `npx tsc --noEmit` (functions), `npm run check:backend-i18n`, `npm run check:email`, `npm run check:generated`, `npm run check:ios-i18n`: pass.
- `swift test --package-path ui/Packages/DIPCore --filter "DIPNotificationCategoryTests|DIPNotificationSettingsModelTests"`: 11 + 30 tests pass.
- App: `xcodebuild build-for-testing` (DIP scheme, simulator Claude-DIP, own DerivedData, deleted afterwards). `-only-testing:DIPUITests/NotificationSettingsUITests`:
  - first branch run: 5 of 5 failed at the shared `openSettings` helper ("Profile has no Notifications row");
  - clean `origin/main` (dfbd2d45, temporary detached worktree, deleted afterwards): 4 of 4 failed the same way, so the failure predates this branch;
  - root cause (UI hierarchy in the result bundle): a fresh mock member starts on the onboarding tour, which covers the shell and swallows the Profile tab tap;
  - fix in the helper: skip the tour like a member, then tap `home.tab.Profile` until it is selected (at most 3 tries) and assert it; no assertion loosened;
  - branch run after the skip step only: 4 of 5 passed; the first test on a fresh install lost the tap to the tour's closing reveal;
  - final branch run on a fresh install: 5 of 5 passed (0 failures), including the new opt-in rows test.
- Design review (docs/design/design-review.md), simulator screenshots en and es, light: round 1 FAIL (P2: email save error shown only at the top of the sheet; Challenges email summary overlapped the new weekly theme row), both fixed; round 2 FAIL on a stale screenshot plus out-of-scope shared parts; round 3 PASS (P3 only).

- After merging origin/main (#352, #353, November 23): conflict in `admin/application/attendees.ts` resolved keeping both sides (no notice to an admin who adds themself, plus the localized notice). iOS gains the `day_before_reminders` email row ("Day-before reminder", default on, en and es) next to Reminders, whose email copy now reads "About an hour before activities you joined"; Swift tests 12 + 32 pass. Functions: `tsc`; full `gcp/functions/tests/unit` plus the targeted `gcp/tests/unit` notification, email, invites, submissions and admin files: 309 tests, 303 pass, 0 fail, 6 todo. `check:generated`, `check:backend-i18n`, `check:email`, `check:ios-i18n` pass. `NotificationSettingsUITests` (fresh install): first run 5 tests, 1 failure (the tour's Skip landed on the interests step, which draws its own tab bar copy, so the Profile tab matched twice); the helper now skips through both tour steps (bounded) until the tour title is gone; rerun 5 tests, 0 failures, including the new day-before row assertions.

## Decisions

- Audience: every active member of any role (`member`, `organizer`, `admin`); status missing or `active`; unknown roles excluded so a malformed doc never widens the audience. The router's send-time membership check is unchanged (it already drops deactivated users).
- iOS writes `admin_digest: false` for members when they save an email switch (the preference document always holds every offered switch); inert because the server re-checks the admin role at send time and rules accept the key for every owner. `admin_suggestions` stays portal-only.
- Review decisions: accepted the per-switch email error placement and the email-only Challenges summary; rejected changing the shared error block style, the Per-activity card copy and app-wide colors (shared design-system parts out of scope), and "Weekly theme email" naming (owner-specified).
- Localized in-app notices: reuse push catalog copy; kept English for attendee removed and "Changes needed" because those transactions do not read the recipient document.

## Handoff

- Not verified on a device: per-recipient in-app language, the weekly theme push to an organizer, and the iOS rows against live Firestore (runbook steps updated).
- Other UI test classes that launch `--mock-member` on a fresh install and tap tabs (for example `DuoLayoutUITests`) may hit the same onboarding-tour overlay; not checked here.
- iOS accepts only `member` and `admin` roles, so organizers cannot sign in to the app (`ui/Packages/DIPAccounts/Sources/DIPAccounts/Accounts.swift:17`, `ui/DIP/Data/Accounts/FirebaseAccountsRepository.swift:67`); coordinator to decide on a follow-up.
- Remaining English-only texts are listed in docs/design/push-catalog.md (Notification text language).
