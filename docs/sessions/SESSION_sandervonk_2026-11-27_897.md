# Work session

User: sandervonk
Date: 2026-11-27
Workstream: ios-polish-wave4
Agent: Claude (Opus), with fresh Opus reviewers
Status: completed

## Summary

iOS polish program, wave 4, on main after #376. Leftover wave 2 and 3 P3s (points sign, time on past activity pages, one text-action style, Release launch timing), an organizer walk-through with a new `--mock-organizer` flag (organizer sign-in landed in #374), and a fresh audit against the quality bar ranked in the new "Wave 4" section of `docs/design/polish-2026-11/ios.md`, critiqued by an independent Opus reviewer before the fixes. No new product features; iOS only.

## Changes

- Review tooling: `MockLaunch` mode `.organizer` (`--mock-organizer`, Debug only) and `PreviewAccountsRepository` seeds an organizer profile (Alex Morgan, `organizer@example.invalid`, role organizer, same fixture company).
- Motion tokens (`DIPMotion`): `reveal` and `revealTransition`, `skeletonGrace`, `quick`, `toastIn`, `toastOut`, `toastTransition`, `stateChange`. Used by the shell (`DIPPrototypeApp` load phase, phone and Duo), `DIPMemberHome` boot, album, notifications, notification settings, event page toasts and Join to Chat, album and photo comment toasts, invitations tab switch, chat, notifications banner, invite pill swap (`DIPDetailActionRow`). `DIPPageSkeleton` fades in after 150 ms. Rewards gift press on `DIPMotion.press` with a Reduce Motion dim.
- `DIPTextActionRow`: semibold, `inline` variant, shared font; adopted by Read more (chevron), Mark all as read (check), View activity, Notification settings and Retry interests.
- Points copy (`DIPPointsFormat`, `ChallengeSubmission`, DIPCore catalog en/es/tlh): "Earn 50 points", "You earned 50 points." (and the one-point English plural fix). Tests updated.
- Event page: time range on past pages; cancelled notice under the title (removed from the info card); no Share on cancelled activities (`showsShare`); Who's Attending counts roll.
- Album empty state centered; Rewards balance pill moves under its title when it does not fit; profile interest catalog skeleton and shared retry; notification settings grouped per section; notifications banner haptics removed.
- Docs: `docs/design/polish-2026-11/ios.md` Wave 4 (ranked findings, audit review, log).

## Validation

- `xcodebuild build` DIP scheme, Debug, Claude-Base (shared scratch DerivedData), after each change: succeeded. `xcodebuild build` Release (for launch timing): succeeded; its output was deleted after measuring.
- `xcodebuild build` ComponentPreview `Preview` scheme (generic iOS Simulator): succeeded.
- `swift test` DIPCore `--filter "EventRewardPointsTests|ChallengeSubmissionTests"`: 20 tests, 0 failures.
- `xcodebuild test -only-testing:DIPUITests/NotificationSettingsUITests` on Claude-Base: 5 passed.
- `npm run ios:i18n-sync -- --derived-data <scratch>` then `npm run check:ios-i18n`: OK (1131 keys).
- Captures: audit of `main` (en and es 14 screens each, XXXL and AX3, states, chat, photo viewer, onboarding, Duo folded and open); after set (21 captures) plus organizer set (14 screens, join and chat). Launch timing with simulator screenshots and an xctrace Time Profiler run (numbers in the ios.md wave 4 log).
- Not run (targeted-tests rule): full suites, `npm run check`, rules tests, ComponentPreview UI tests.

## Decisions

- Audit review (Opus): accepted ORG-1 first, skeleton grace delay, visible copy and layout items above motion cleanup, PERF-2 as a measurement, new SET-1, JOIN-1, EVT-3, A11Y-3, ST-8. Not taken: a minimum skeleton time, removing stepper and switch selection ticks, TYPE-2 now (challenge header shares its row with the mascot).
- Design review: three fresh Opus rounds (FAIL, FAIL, PASS). Round 1 P2 (cancelled info card heading peeking under the bar) fixed by moving the notice under the title; round 2 P2 was a stale capture. Rejected P3s are listed in the ios.md wave 4 log.
- Skeleton grace uses a delayed animation, not `Task.sleep`, after a capture showed a busy launch holding the task back.
- Launch time: no app-side fix; the Release trace is dominated by dyld and Swift conformance lookups on the simulator.
- White text on the light purple and pink pills stays (owner decision).

## Handoff

- PR to main, not merged, not deployed, no TestFlight upload.
- Open: A11Y-3 (Home challenge card at AX3), ST-8 (shell failure without header), CHAT-1 (chat sheet chrome), TYPE-2 (Home headers at XXXL), ST-7 (Home empty and Activity full next steps, product decision), PERF-2 device measurement with the App Launch template.
- Before and after showcase PNGs were saved in the session scratchpad for the owner.
- Simulator lock released, DerivedData and traces deleted, status bars cleared, simulators shut down.
