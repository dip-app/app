# Work session

User: sandervonk
Date: 2026-11-10
Workstream: Designed empty states
Agent: Claude Code
Status: handoff

## Summary

Added one reusable, designed empty state and used it everywhere V1 lists can be empty (FRONTEND_STATUS V1-03, V1-04, V1-07, V1-10): Home events and recent co-attendees, event "Who's Attending" / challenge "People that completed", Participants, My Events Active and Memories, and the album. Each replaces a plain grey line or, on Home, an empty carousel. Opt-in review fixtures (`--empty-state=<fixture>`) show each state without altering the reference fixture.

Code, unit tests and the Preview build are done. Simulator screenshots and the new UI tests were NOT run: CoreSimulator was unresponsive on the development Mac for this whole stretch (load average ~800-1000; `simctl install` hung for over 30 minutes and other sessions' `simctl boot`/`bootstatus` hung for over 90). See Handoff.

## Changes

- `ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Components/DIPEmptyState.swift` (new): `DIPEmptyStateContent` (SwiftUI-free values: trimmed title/body/action, `empty.<screen>` identifiers, combined VoiceOver label) and `DIPEmptyState` view with `.card` and `.compact` styles. It shows token-coloured Crew faces (`DIPCrewFaces`/`DIPCrewFace`, drawn as shapes with no bundled artwork, decorative and hidden from VoiceOver), a one-line title, one line of body and an optional single action (44 pt minimum, `DIPPressFeedbackStyle`). The compact style stacks vertically at accessibility text sizes. The faces fade/scale in once (`DIPMotion.navigationDuration`); Reduce Motion skips it. Nothing loops.
- `ui/Packages/DIPDesignSystem/Tests/DIPDesignSystemTests/Components/DIPEmptyStateTests.swift` (new): identifier slugging, label punctuation, blank message/action dropped, `ImageRenderer` render of both styles x face counts x Large/AX5.
- `ui/Packages/DIPCore/Sources/DIPMockData/DIPMockFixtures+EmptyStates.swift` (new): `DIPEmptyStateFixture` (`home-events`, `home-recents`, `attendees`, `my-events`, `album`) and `DIPMockFixtures.emptyStateReview(_:)`. These empty the sources that `DIPEventLists` actually reads (event details, not only the summary arrays).
- `ui/Packages/DIPCore/Tests/DIPCoreTests/EmptyStateFixtureTests.swift` (new): each fixture empties exactly its list through `DIPEventLists`; reference unchanged.
- `ui/DIP/Features/Home/DIPHomeScreen.swift`: no-events card instead of an empty carousel (the old `home.events.empty` text is gone; nothing referenced it); compact empty recents hides See All. Carousel and recents extracted into private properties; populated layout unchanged.
- `ui/DIP/Features/Shared/DIPDetailComponents.swift`: `DIPDetailPeopleRow` gains `emptyTitle` (default "Be the first") and shows a compact empty state (`empty.<prefix>-attendees`, replacing `<prefix>.attendees.empty`).
- `ui/DIP/Features/EventDetails/DIPEventDetailsScreen.swift`, `Challenge/DIPChallengeDetailsScreen.swift`: copy for upcoming vs past events and challenges.
- `ui/DIP/Features/Participants/DIPParticipantsScreen.swift`: card when no one has joined.
- `ui/DIP/Features/MyEvents/DIPMyEventsScreen.swift`: Active is "No upcoming events" plus "Find an event", which goes to Home. Memories is "No memories yet".
- `ui/DIP/Features/Album/DIPAlbumScreen.swift`: designed no-photos card. When composed in the shell, "Add photos" opens the shell's picker through the existing binding. Standalone pages use their own bottom picker and show no duplicate action.
- `ui/DIP/Features/Prototype/DIPPrototypeApp.swift`: `--empty-state=<fixture>` selects the review snapshot (with `--screen=` per `DIPEmptyStateFixture.screen`).
- `ui/ComponentPreview/UITests/EmptyStateFlowTests.swift` (new): six flows (each state's identifier/label, hidden See All/carousel, My Events action returns Home with a 44 pt target, AX3 hittability) with keep-always screenshot attachments. **Written but not yet run.**

## Validation

- `swift test --package-path ui/Packages/DIPDesignSystem`: 13 tests, 0 failures (4 new).
- `swift test --package-path ui/Packages/DIPCore`: 44 tests, 0 failures (4 new).
- `xcodegen generate` (ui/ComponentPreview); `xcodebuild -scheme Preview build` on iPhone 17 Pro / iOS 27.0 simulator: BUILD SUCCEEDED with all feature edits. (The UI test file was added after this build. It needs project regeneration and a test run.)
- Component visuals were rendered off-simulator with a temporary `ImageRenderer` test, which was deleted and not committed. Card and compact styles render as intended at standard size. macOS has no Dynamic Type, so those renders do not show the large-text layout.
- Not run: `npm run check` (no `node_modules` in this worktree, and `npm ci` was deferred under the machine load and low disk), `npm run test:rules` (no rules change), main `ui/` DIP app build (it compiles the same `Features` sources as Preview), simulator screenshots, `EmptyStateFlowTests`.

## Decisions

- One component with two styles rather than per-screen views. Empty slots inside a populated page (Who's Attending, recents) use `.compact`. Whole sections and pages use `.card`.
- No action on Home's no-events state: its only plausible destination (My Events) is usually empty too. Actions are offered only where they lead somewhere useful (Find an event, Add photos).
- The illustration is drawn from existing colour tokens, so no new assets or token changes were needed (no shared `tokens.json` edit).
- Identifiers follow `empty.<screen>` with `.message` / `.action` suffixes for tests.

## Handoff

1. When CoreSimulator responds again, run on a dedicated simulator (this session created `iPhone 17 Pro (T4 empty states)`, D73A4AFF-FD1A-4607-8239-3B7C40F688E0. It is local only; delete it when done): `cd ui/ComponentPreview && xcodegen generate`, then `xcodebuild test -scheme Preview -only-testing:PreviewUITests/EmptyStateFlowTests` and the full `PreviewUITests` suite to confirm populated screens are unchanged.
2. Capture review images for each `--empty-state=` fixture (standard and `--large-text`) into `ui/ComponentPreview/Review/Screens/<screen>/`.
3. Run `npm ci && npm run check` before merge.
4. Live data: once real event/RSVP projections land, these states appear automatically for empty lists. Error/retry states remain separate work.
