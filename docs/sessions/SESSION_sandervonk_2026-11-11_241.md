# Work session

User: sandervonk
Date: 2026-11-11
Workstream: iOS hardening: completed events, shake follow-ups, covers, polish
Agent: claude
Status: handoff

## Summary

Hardening and leftover features on `feature/v2-hardening` (from `origin/feature/v2-combined`): events marked `completed` are now visible to members and accept album uploads; shake-to-report follow-ups; event page polish; real per-event covers; a first accessibility pass; stale UI test expectations corrected by reading code; FRONTEND_PLAN status refreshed. No checks were run (the owner runs everything at integration); only `swift test` for DIPCore filters.

## Changes

- Rules and functions: `gcp/storage.rules` (uploads for any non-cancelled event), `gcp/firestore.rules` (event get/list allow `scheduled` and `completed`; chat stays open for non-cancelled events), `finalizeEventPhoto.ts` (only `cancelled` refused), `setRsvp.ts` (a `completed` event is valid stored data and answers `EVENT_CLOSED`). Tests: `gcp/tests/unit/photos.test.ts`, `gcp/tests/rules/photos.test.ts`, `gcp/tests/rules/events-read.test.ts`. Docs: `docs/contracts/callables.md`, `data-ownership.md`.
- iOS completed status: `DIPEventStatus.completed`, `DIPEventLists` (completed + joined = Memories, never discovery/upcoming), join/leave denial, mapper, feed query `status in [scheduled, completed]` (same composite index), album upload mirror.
- Shake to report: `ScreenshotMarkup` (DIPCore) + `ScreenshotMarkupEditor`/renderer (draw, undo, clear; flat; Mark up button in the sheet's screenshot card); "Report a problem?" alert after a shake with a Profile toggle (`ShakeGate.promptKey`); VoiceOver custom action and magic tap. Debug `--simulate-shake` launch argument.
- Event page: Earned/Worth/Earn points row (`DIPPointsFormat.eventRow`), star in the accent colour, Leave Activity spacing, card date and place on two lines (no dangling dot).
- Covers: `PhotoAlbumSource.coverPhoto` (limit-1 query), `DIPEventCover.media(..., photo:)`, repository keeps display copies (max 6 past joined events per session).
- Accessibility: card labels and hints, join/leave announcements, Leave hint.
- UI test repairs: `MockMemberLaunchUITests`, `ScreenFlowTests`; `HomeThemeTests.testErrorRetries...` reviewed, no change found.
- Onboarding motion (additive, unverified): idle float on the B0 crew (off with Reduce Motion), a slight scale on Stage content transitions, the bar rising in with the header chrome, a cross-fade on the step pill. The tour already had the spec v4 motion system (staggered title entrances, crew morphs, window reveal), so nothing else was added; there is no paging carousel, so no parallax or page indicator (the crew stack is the progress).
- Docs: `docs/milestones/v2/FRONTEND_PLAN.md` status rows.

## Validation

- `swift test --filter` in `ui/Packages/DIPCore` for EventCover, EventLists, ParticipationRules, EventMetadata, ScreenshotMarkup, ShakeGate, EventRewardPoints: passed. Nothing else was run.

- Onboarding motion was NOT screenshot-checked or audited: only ~3 GB of disk was free, too little for a derived-data build under the 1.5 GB floor.

## Decisions

- Decision on rejected statuses: only `cancelled` is refused for uploads and chat.
- Server-side bug report rate limiting not built: rules cannot count, and a limits document would rewrite every existing report rule test. Needs an owner call (callable vs rules plus limits doc).
- Covers: Home cards only show a photo for events that have one in the session; upcoming events have no album, so in practice this affects Memories.
- Organizer `updateEventV1` still accepts only scheduled/cancelled; whoever sets `completed` (admin backend) must add it.

## Handoff

Owner deploy list: `firebase deploy --only firestore:rules,storage,functions:dip:finalizeEventPhotoV1,functions:dip:setRsvpV1` (no index change). Unverified: everything in the app target (build, DIPTests, UI tests), the VoiceOver actions, the rules emulator tests.
