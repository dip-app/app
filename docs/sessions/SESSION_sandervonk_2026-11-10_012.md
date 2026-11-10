# Work session

User: sandervonk
Date: 2026-11-10
Workstream: Weekly theme iOS Home card
Agent: Claude Code
Status: handoff

## Summary

Workstream T2 of the weekly-theme spec (sections 1, 2, 6): the iOS Home "This Week's Challenge" card now reads the current weekly theme (a `Challenge`) for the member's company and opens a read-only detail. Built against the spec and a fake source while T1 builds the backend (rules, callables, seed) on `feature/weekly-theme-backend`. The live Firestore adapter follows the spec query but has not run against T1's rules or seeded production data. Sequence 012 was chosen deliberately so parallel workstream logs for the same date do not collide.

## Changes

- `ui/Packages/DIPCore/Sources/DIPCore/ThemeCatalog.swift`: `DIPThemeCatalog` (`catalog://theme/<key>` -> display name, bundled illustration, accent token, goal-unit suggestions); `fitness` reuses the existing `Mascot` asset on `challengeAccent`; unknown keys or non-catalog URLs get a neutral fallback (gray `surfaceMuted`, no illustration, title only).
- `ui/Packages/DIPCore/Sources/DIPCore/WeeklyChallenge.swift`: `DIPWeeklyChallenge`, current-window selection, projection to summary/detail (window "Nov 9 - Nov 15" in America/New_York, goal "3 workouts", reward "+50 points"), member copy, `DIPChallengeCardState` (loading/current(stale)/none/failed).
- `Models.swift`: `DIPChallengeSummary` gains optional artwork, accent, participation text and VoiceOver label; `DIPChallengeDetail` gains goal/reward/accent (additive, defaults kept).
- `DIPMockData/DIPChallengeFixtures.swift` + reference snapshot: Fitness fixture (count 0/1/128), reference card built through the catalog (same content as before).
- `DIPDesignSystem` `DIPChallengeCard`: new theme-driven initializer (accent, title colour, optional artwork, optional avatar stack, text, label); avatar stack omitted cleanly; Dynamic Type accessibility sizes grow the card instead of clipping. Existing initializers and the reference geometry are unchanged.
- `ui/DIP/Domain/Challenges/MemberChallengesRepository.swift`: scope/lease repository (same pattern as MemberEventsRepository): server read, cache fallback only when unavailable (marked stale; empty cache = error), validation of tenant, order, limit, bounds, invalidation on sign-out/account change.
- `ui/DIP/Data/Challenges/`: `ChallengeDocumentMapper` (strict Timestamp -> `Challenge` DTO) and `FirebaseChallengeReadSource` (auth + membership listeners, the spec query).
- `ui/DIP/Features/Challenge/WeeklyChallengeFeed.swift`: card state machine + `WeeklyChallengeHost` (creates the SDK repository in `.task`, injects via environment, refreshes on foreground, stops on disappear).
- `ui/DIP/Features/Home/DIPHomeChallengeSection.swift` and `DIPHomeScreen.swift`: all card states (skeleton, card, empty, error with in-place retry, offline badge).
- `ui/DIP/Features/Challenge/DIPChallengeDetailsScreen.swift`: read-only detail (window, illustration, title, description, goal, reward, how it works, "Submissions open soon"); Join/Leave, completed list and "Add Your Entry" notice removed.
- `DIPPrototypeApp.swift`: consumes the environment feed; challenge route has no bottom action (tabs remain); pull-to-refresh also reloads the theme.
- `DIPApp.swift`, `FirebaseBootstrap.swift`: configured builds wrap the member Home in `WeeklyChallengeHost`; unconfigured builds keep the fixture card.
- Preview host: `HomeThemePreview` + `--home-theme=live|none|error|loading|offline|unknown`, `--home-theme-count=0|1|128`; `project.yml` adds `../DIP/Domain/Challenges`.
- Tests: `DIPCoreTests/WeeklyThemeTests.swift`, `DIPTests/Challenges/*`, `ComponentPreview/UITests/HomeThemeTests.swift`.
- Docs: `docs/design/components.md` card row, `ui/ComponentPreview/README.md` launch arguments.
- Screenshots: `ui/ComponentPreview/Review/Screens/WeeklyTheme/`.

## Validation

See the PR description for the exact command results of this session (swift test for four packages, project generation, Preview and DIP simulator builds, DIPTests, Preview UI tests). All UI and app tests ran against fakes; no emulator or production read was performed.

## Decisions

- No theme this week: a small designed card ("No weekly theme right now. A new one starts Monday.") with the bundled character avatars (AvatarTeal/Red/Pink), not a hidden section, so members learn the feature exists. T4's `DIPEmptyState` did not exist on main; this card can adopt it later. It is shorter than the 225 pt card, so loading -> none shifts content once; loading -> card and loading -> error do not.
- Window text uses America/New_York (the spec's week definition) on every device; selection compares absolute instants.
- Fitness illustration maps to the existing `Mascot` image set rather than a duplicated asset.
- Mapper fails closed for the whole read on one malformed document (EventDocumentMapper behaviour); a future `type` or unknown theme key still decodes (selection only picks `type == "weekly"`; the catalog falls back).
- Offline: server first; cache only on `unavailable`; permission-denied never consults the cache.
- "+ 1 other participating" (singular) and "Be the first this week" for 0.
- The read-only detail is also used for the mock path; the mock repository's join command remains for its existing tests but no UI calls it.

## Handoff

- Live path depends on T1: rules allowing same-company bounded `list` on `companies/{companyId}/challenges` with the query `endDate >= now orderBy endDate limit 5` (no `companyId` equality filter). If T1's list rule requires `resource.data.companyId == companyId` (as the events rule does), the iOS query must add `whereField("companyId", isEqualTo:)` and a composite index (companyId ASC, endDate ASC) is needed.
- Production seeding (orchestrator) must create the Fitness theme; until then a configured member sees the empty card (or an error card if rules are not deployed).
- Participant avatars are not in v1; the pill shows text only. Submissions (F3/V2) will replace the "Submissions open soon" note.
- Not done: emulator end-to-end read test for challenges (needs T1 rules/seed); physical-device and manual VoiceOver review.
