# Work session

User: sandervonk
Date: 2026-11-27
Workstream: ios-organizer-signin
Agent: Claude
Status: completed

## Summary

Organizers could not sign in to the iOS app. The app accepted only `member` and `admin` in two places (MembershipContext and the resolveMembershipV1 response check), so an organizer's profile was treated as invalid ("We couldn't load your profile"). Three member-facing callables (setRsvpV1, finalizeEventPhotoV1, registerDeviceV1) also refused organizers, so fixing the app alone would have left them unable to RSVP, publish album photos or get push. Organizers now use the app as full members; organizer tools stay in the admin portal.

## Changes

- `ui/Packages/DIPAccounts/Sources/DIPAccounts/Accounts.swift`: new `MembershipRole` enum (member, organizer, admin), the single iOS role set. `MembershipContext` accepts any known role and exposes `membershipRole`; unknown roles still fail closed. New `ResolveMembershipResponse.validated()` holds the response check.
- `ui/DIP/Data/Accounts/FirebaseAccountsRepository.swift`: resolveMembership uses `validated()` instead of the inline `["member", "admin"]` list. The Firestore profile mapper already goes through MembershipContext.
- `ui/DIP/Features/Accounts/DIPMemberHome.swift`: the admin digest switch uses `membershipRole == .admin` (still admin only; the server sends that email only to admins).
- `gcp/functions/src/modules/{participation/application/setRsvp.ts, photos/application/finalizeEventPhoto.ts, notifications/application/devices.ts}`: membership checks use `isRole` from `admin/domain/permissions.ts`, so organizers are allowed. Company match, deactivation and Google/verified-email checks are unchanged.
- `gcp/functions/src/modules/{submissions/application/submissionCommands.ts, invites/domain/invitePolicy.ts, accounts/application/setMyLocale.ts}`: replaced the duplicated three-role literals with the same `isRole`. No behavior change.
- Tests: `gcp/tests/unit/{participation,photos,notifications}.test.ts` (organizer allowed, other-company organizer refused before tenant reads, unknown role refused, no writes); `ui/Packages/DIPAccounts/Tests/DIPAccountsTests/AccountsTests.swift` (every role builds a context, unknown roles fail, organizer profile reaches member state, response validation); `ui/DIPTests/Accounts/ProfileDataTests.swift` (Firestore mapper accepts organizer and refuses an unknown role).

## Validation

- `node --import tsx --test` on gcp/tests/unit participation, photos, notifications, accounts-set-locale, accounts-roster-claim and the invite/submission unit files: 160 tests, 0 failures.
- `tsc --noEmit` in gcp/functions: OK.
- `swift test --package-path ui/Packages/DIPAccounts`: 34 tests passed.
- `xcodebuild test` scheme DIP, `-only-testing:DIPTests/ProfileDataTests` on the Claude-DIP simulator under `/tmp/dip-sim-lock`: 7 tests passed (app build included).
- `xcodebuild build` ComponentPreview scheme Preview (generic iOS Simulator): succeeded.
- `npm run check:ios-i18n`: OK. DerivedData and SwiftPM scratch output deleted; lock released.

## Decisions

- Firestore and Storage rules need no change: member reads and writes key off `own()` and `sameCompany()`, which ignore role. `npm run test:rules` not run.
- resolveMembershipV1 already accepts and returns `organizer` (existing roster-claim tests cover it).
- No role text is shown anywhere in the app (no profile badge), so no new localized label was added.
- Challenge submission review and evidence reads stay admin only, as before; organizer tools stay in the admin portal.
- docs/design/quality-bar.md does not exist in this checkout.

## Handoff

- Deploy needed for the three callables (setRsvpV1, finalizeEventPhotoV1, registerDeviceV1) before organizers can RSVP, publish photos or register for push. Not deployed here.
- A new TestFlight build is needed for organizers to sign in. Not uploaded here.
