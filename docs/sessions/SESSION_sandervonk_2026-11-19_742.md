# Work session

User: sandervonk
Date: 2026-11-19
Workstream: ios-0-1-2
Agent: Claude (Opus), iOS area owner for TestFlight 0.1.2
Status: completed

## Summary

iOS work for TestFlight 0.1.2, owner-approved scope. (1) The app sends the member's language to the server
(`setMyLocaleV1`) so emails and pushes match the app. (2) Push client: `DIP_INVITE` Accept and Decline buttons answer
through the in-app invite-answer path; `comment`, `photo_added` and `attendee_removed` rows in the notification center;
any push type opens its `deepLink` (or `eventId`); new settings copy for Comments and photos. (3) Friendly-errors
follow-ups: a typed `DIPRepositoryError.rejected(DIPMemberMessage)` replaces `invalidInput(String)`, one localized
"not connected" sentence, localized mock refusal messages. Nothing deployed, nothing uploaded to TestFlight. Push
actions are device-unverified.

## Changes

- Member language: `ui/Packages/DIPAccounts/Sources/DIPAccounts/MemberLocale.swift` (new: `MemberLanguage` mapping,
  `MemberLocaleRepository`, `MemberLocaleSync`), `FirebaseAccountsRepository` (`setMyLocaleV1` adapter; the profile
  mapper now reads the optional `locale`), `PreviewAccountsRepository` (mock behavior: merges and republishes the
  locale), `DIPApp.swift` (sync on sign-in and on foreground).
- Push: `ui/DIP/Domain/Push/PushNotificationActions.swift` (new: `PushPayload` with link fallback,
  `PushResponseAction`, `PushInviteResponder`), `PushCoordinator.handleResponse`, `PushSystem` gains `isForeground`
  and `postInviteFallback`, `FirebasePush.swift` (category registration, response handling, fallback notification),
  `FirebaseBootstrap.makePushInvitesRepository(companyID:)`.
- Notification center: `DIPNotificationKind.attendeeRemoved` and the `photo_comment` alias, row icon and accent,
  album hint for comment and photo rows; mock fixture gains a comment row and a removed row.
- Settings: `notif.category.social.summary` now "Comments on your photos and new photos from activities you went to"
  (es updated). Category keys unchanged.
- Errors: `DIPMemberMessage`, `DIPRepositoryError.rejected` and `memberMessage` in `DIPRepository.swift`; every former
  `invalidInput` throw site and the four display sites (chat, photo comments, album upload queue, RSVP message);
  `shell.notice.notConnected` with a parameter (Spanish feature names without articles, sentence number-neutral).
- Mock: `DIPMockRepository.swift` refusals localized through a new DIPMockData catalog
  (`Resources/Localizable.xcstrings`, Package.swift resources); `scripts/ios-i18n-check.py` (DIPMockData target scans
  only that file; file entries allowed) and `scripts/ios-i18n-sync.py` (new catalog).
- Tests: `DIPAccountsTests/MemberLocaleTests.swift` (new), `DIPTests/Push/PushNotificationActionTests.swift` (new),
  `ProfileDataTests` (locale sync through the preview listener, mapper), `PushRegistrarTests` fake, renamed cases in
  `RepositoryTests`, `SocialCommandTests`, `MemberAlbumTests`, `AlbumPolishTests`, `MemberEventAppRepositoryTests`,
  `NotificationRulesTests` kinds, `DIPNotificationsModelTests` count.
- Docs: push-client, push-catalog, push-triggers, push-device-verification (rows 28 and 30 to 39), backend-i18n,
  ios-i18n, CURRENT_STATE, STRETCH_GOALS.

## Validation

- `swift test --filter MemberLocale` in DIPAccounts: 6 tests passed.
- `swift test --filter "NotificationRules|SocialCommand|RepositoryTests|DIPNotificationsModelTests"` in DIPCore: 15
  XCTest and 17 Swift Testing tests passed.
- `xcodebuild build-for-testing` (scheme DIP, Claude-Base iOS 27.2 simulator, own DerivedData): succeeded, no new
  warnings in touched files.
- `xcodebuild test-without-building` with `-only-testing` DIPTests/PushNotificationActionTests, PushRegistrarTests,
  ProfileDataTests, AlbumPolishTests, MemberAlbumTests, MemberEventAppRepositoryTests: 57 tests, 0 failures (under
  `/tmp/dip-sim-lock`, released afterwards).
- `npm run ios:i18n-sync` after the build, then `npm run check:ios-i18n`: OK (1101 keys in 7 catalogs).
  `python3 -m unittest scripts/tests/test_ios_i18n_check.py`: OK.
- Simulator screenshots (mock member, English and Spanish): notification center top and scrolled, Profile >
  Notifications. Design review round 1 (fresh Sonnet): FAIL with two P2s, both outside this change (see Decisions).
  Round 2 (fresh Sonnet, scoped to the changed rows and copy): PASS, three P3s.
- Not run: full UI test suites (owner rule), push actions on a device (needs APNs and phones).

## Decisions

- Both invite buttons run in the background and require an unlocked device; Decline is not destructive styling.
  `INVITE_ALREADY_RESPONDED` counts as done; any other failure posts a local notification (background) or opens the
  activity (foreground). The repository is built from the Firebase user and the push's `companyId` because a
  background launch has no member session on screen; the server checks membership and recipient.
- Locale: app language wins over a portal-saved value; at most one call per member and language per launch, failures
  retried next launch, no logs.
- DIPMockData gets its own catalog for refusal messages only; fixture content stays verbatim like server content.
- Review round 1 P2 "header chip contrast" rejected: pre-existing, unchanged by this work. P2 "no off-by-default cue
  on Comments and photos" rejected: the switch shows the member's current choice, and a default label would be wrong
  once changed. P3s (badge size, shared disc tint, wording "album photos") left as is.
- English copy changes on the regular iPhone experience: only the Comments and photos description (owner-requested).

## Handoff

- Device checks: rows 30 to 39 of docs/ops/push-device-verification.md (actions from banner and lock screen,
  background and force-quit launch, offline fallback, signed out, unknown type, center icons, locale calls).
- In-app notice titles and bodies are written by the server in English (`build("en")` in socialTriggers); localizing
  them is a backend follow-up.
- Coordinator: merge, then deploy and upload per the release plan; nothing here needs a server change.
