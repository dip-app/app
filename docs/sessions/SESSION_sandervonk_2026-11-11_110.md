# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Stream D interest filter and points
Agent: Claude Code
Status: completed

## Summary

F1 interest filtering on Home and F2 points balance display, on the integration branch `feature/v2-remaining` (branch `feature/v2-stream-d`).

## Changes

- DIPCore: `DIPInterestFilter` (active interests = stored ids the catalog still knows, any-match filter, order preserving, untagged events never match), `DIPHomeEventScope`, `DIPHomeScopeStore` (UserDefaults per uid, default All events), `DIPPointsFormat`; `tagIDs` on DIPEventSummary and DIPEventDetail; `pointsBalance` on DIPProfile. Tests: InterestFilterTests (filter, retired/unknown ids, many tags, stable order, store, tag propagation) and PointsFormatTests.
- Home: "Matching your interests / All events" toggle (DIPSegmentedToggle, new `.soft` style, height, inset), outlined "Showing N of M" pill and tinted read-only interest chips, shared `DIPEmptyState` for no matches (`empty.home-filter`, "Show all events"; pagination-aware copy when more pages exist). The control appears only for account-backed members with at least one catalog-known interest; fixture Home keeps its reference layout. Default All events; scope saved per uid and read at init (no flash); no extra reads.
- Rewards: "Your points" row with an outlined (informational) balance pill; real `pointsBalance` from the profile document, 520 for mock/fixture profiles; entries stay mock.
- Repository/profile bridge: `tagIDs` from `Event.tagIds`, `pointsBalance` from `AppUser`.
- Preview review states: `--home-filter=match|nomatch|unknown`, `--points=<n>`; UI tests in HomeFilterTests.

## Validation

- `npm run test:swift`: 161 tests, 0 failures. DIPTests MemberProfileBridgeTests, MemberParticipationTests, AccountsStageTests: 44, 0 failures.
- Preview UI: HomeFilterTests (5) and HomeReferenceTests (3) passed; MotionInteractionTests, MemberEventsFlowTests, ScreenFlowTests (testMyEventsMemories..., testProfileEditsAndMemoryNavigation) passed. `ScreenFlowTests.testJoinAttendeesAndChatKeepLocalState` fails at its first assertion ("Activity Chat" instead of "Join the Activity"); this is the join/chat flow, not touched here, and I did not check it on the branch baseline.
- Screenshots: ui/ComponentPreview/Review/StreamD.

## Quality rounds

- R2 self-review: first fixture Home layout changed (filter control shifted the reference geometry); fixed by showing it to account-backed members only.
- R3 design audit: round 1 REVISE (~7.6): Rewards pill placement, heavy toggle, spacing, chip wording; applied. Round 2 (REVISE, ~7.9, no criterion below 7; PASS needed loading/offline states and a clearer counter): counter now reads 'Showing N of M events' and is hidden when nothing matches, unselected toggle label darkened; not done: loading skeleton and offline variants (Home loads before the filter shows; no separate loading state exists), flexing the two matching cards to equal columns, a zero-points nudge.
- R4 code review: APPROVE WITH FIXES, one MAJOR (empty state false while more pages exist: copy and count made pagination-aware), minors: scope read at init (done), explicit toggle inset (done); not done: clearing the saved scope on sign-out (key is a harmless preference), tokenising chip metrics.

## Decisions

- Default is All events so browse-all is never lost. Filtering is over loaded pages only.

## Handoff

Unverified: loading and offline states with the filter on a live feed; VoiceOver. The Rewards history is mock.
