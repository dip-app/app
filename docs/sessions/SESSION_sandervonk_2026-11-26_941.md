# Work session

User: sandervonk
Date: 2026-11-26
Workstream: ios-polish-1
Agent: Claude (Opus), with Sonnet capture and measurement subagents and fresh Opus reviewers
Status: handoff

## Summary

iOS polish program, wave 1 (November 2026 quality bar). Audited every iPhone and iPhone Duo screen and state on the simulators (English, Spanish, XXXL, AX3, interactive flows, Duo folded and open), wrote the ranked findings in `docs/design/polish-2026-11/ios.md` (28 items, independently critiqued by an Opus reviewer before any code changed), then fixed the design-system level items: press feedback, scroll edge fades, bar fade, page skeletons, the shared failure state, the stale-data pill, photo scrim consistency and review fixtures that the `--mock-member` app ignored.

## Changes

- `docs/design/polish-2026-11/ios.md`: ranked audit, audit review outcome, wave log.
- DIPDesignSystem: new `DIPPressStyles.swift` (`DIPMotion.press`, `DIPCardPressStyle`, `DIPRowPressStyle`, `DIPIconPressStyle`), new `DIPSurfaceEffects.swift` (`DIPPhotoScrim`, `DIPEdgeFade` with the floating-bar preset, `dipTopEdgeFade()`, `DIPPausedPill`), `DIPPageSkeleton` (tab, detail, rows, grid) in `DIPSkeleton.swift`, `DIPEmptyState` `tone: .failure`; Home event card and challenge card use the card press and the shared scrim; header bell and avatar use the icon press.
- Shell (`DIPPrototypeApp.swift`): bar fade behind the floating bar and the Duo action bar; tab-page skeleton instead of the "Loading…" spinner; route skeletons (detail, album grid); shared failure card instead of `ContentUnavailableView`; "Updates paused — Retry" replaced by a floating pill (no layout shift, no em dash); My Events unavailable and Activity unavailable use the shared empty state.
- Screens: press styles on My Events cards and memories, album photos, back and close buttons, Duo rail, See All, retry buttons; `dipTopEdgeFade()` on Home, My Events, Rewards, event, challenge, album and participants scroll views; My Events cards and memory tiles gain the photo scrim; album and notification-settings loading skeletons; invitation-card skeleton; member Home boot skeleton and failure card; failure tone on every load-failure empty state; Rewards empty state drops its duplicate "Find an event" and the navigation haptic; share fallback text without an em dash.
- Review tooling (Debug only): `MockLaunch.snapshot` honors `--empty-state=…`, `--event-full`, `--event-cancelled` and `--screen=event` (not joined); `--shell-state=loading|failed` hold or fail the first snapshot; `DIPMockRepository(firstSnapshotDelay:)`; `DIPMockFixtures.emptyStateReview(_:base:)`.
- String catalogs: new keys translated to Spanish, removed keys deleted (`npm run ios:i18n-sync`, then the check).

## Validation

- Simulator audit: `xcodebuild build` (DIP scheme, Debug, Claude-Base, own DerivedData in the session scratchpad), 57 Base states plus 22 interactive flow captures, 21 states on Claude-Duo folded and 24 open.
- After: `xcodebuild build` (DIP scheme) succeeded after every change; about 35 after captures (Base), including the new review flags and scrolled states.
- Preview target: `xcodebuild build` of the `Preview` scheme (`ui/ComponentPreview`, generic iOS Simulator) to confirm the listed-subset target still compiles.
- `swift test --package-path ui/Packages/DIPCore --filter "EmptyStateFixtureTests|RepositoryTests"`: 17 tests, 0 failures (two new tests). `swift test --package-path ui/Packages/DIPDesignSystem --filter DIPEmptyStateTests`: 4 tests, 0 failures.
- `npm run ios:i18n-sync -- --derived-data <scratchpad DerivedData>` then `npm run check:ios-i18n`: OK (1124 keys). `python3 scripts/check-docs.py`: OK.
- Design review (fresh Opus reviewer each round, before and after screenshots): round 1 FAIL (3 P2: no Back on the loading skeleton, white on gray unavailable bar, cancelled date pill in another format), round 2 FAIL (2 P2: cancelled page still offered Directions, shell failure copy and placement), round 3 FAIL on one P2 that was a stale capture (two failure screens captured before the glyph change); recaptured, all failure states now share one glyph. P3s are carried to wave 2 in the audit.
- Not run: full suites, `npm run check`, `npm run test:rules`, UI tests (no UI test touched; owner rule: targeted tests only).

## Decisions

- Press feedback is three variants, not one scale for everything (card 0.985 plus dim, row highlight, icon scale), after the audit review warned that a large scale on photo cards moves edges and muddies photos.
- The bottom bar fade is short (36 pt visible above the bar, solid from the bar's center down) instead of a tall white wash, so photo pages keep their photos.
- The top fade appears only once content has scrolled (iOS 18 scroll geometry); at rest nothing is faded. iOS 17 keeps the plain edge. Profile keeps its existing status-bar fade.
- 24-hour times in the captures come from the simulator's `AppleICUForce24HourTime`, not the app.
- No brand launch image yet: it needs a logo asset in the app catalog and a Release measurement on a device.

## Handoff

- Wave 2 (screen level) is listed in the audit: event page facts row and secondary actions, relative event dates and spots left, notifications header actions and swipe actions, section header style, contrast proposals for the owner, AX3 card chips, Duo profile and folded carousel, Sign out and Leave rows, failed upload tiles, pull to refresh.
- USD-only cost formatting needs a currency field in the event contract (backend owner).
