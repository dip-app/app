# Work session

User: sandervonk
Date: 2026-11-11
Workstream: V2 stream A event and theme pages
Agent: Claude Code
Status: active

## Summary

Stream A on the integration branch `feature/v2-remaining` (not main): event change history, event reward points, weekly-theme page polish, push client behind a flag. PRs target `feature/v2-remaining`; each runs build, self-review, design audit, code review and verification rounds.

## Changes

PR 1 (change history): DIPCore DIPChangeLog.swift (entries, pure text), DIPEventMetadata.changeLog and pointsValue, EventDocumentMapper decodes changeLog, MemberEventsRepository.metadata maps it, DIPEventChangesSheet, "See what changed" solid pill on the event page, Preview fixtures, tests (ChangeLogTextTests, EventDocumentMapperTests, ChangeHistoryTests UI).

PR 2 (event reward points): DIPEventSummary.pointsValue from metadata, DIPPointsFormat.reward/rewardShort, outline icon-left pill on the event page (`event.points`) and Home photo cards (`home.event.points`), hidden at 0; fixtures; Preview target build fix after Stream B (AlbumImageProcessing source, canImport guard).

PR 3 (weekly-theme polish): DIPChallengeDetail start/end dates, pure phase/statusNote/calendarFields (all-day week, New York days, floating all-day in EventKit), solid calendar window pill (outline once ended, icon kept), tinted info card with how-it-works and phase note, Preview phase host and tests.

PR 4 (push client): flag-gated registration, per-member device key, unregister and token deletion at sign-out, priming after the first join, deep links with chat flag and cold-launch buffering; docs/design/push-client.md.

## Validation

- PR 4: DIPCore 202 tests, DIPTests PushRegistrarTests (14) with fakes, DIP and Preview builds; review APPROVE WITH FIXES, all applied. Device-unverified.
- PR 3: DIPCore ChallengeWindowTests (4), DIP build, Preview ChallengePhaseTests (3), AddToCalendarTests, PillRule challenge test passed; audit REVISE-minor (~7.8) and review APPROVE WITH FIXES, fixes applied (ink status note, icon kept in the outline pill, floating all-day dates, Added disables the button). HomeThemeTests.testErrorRetriesInPlaceAndKeepsOtherHomeContent fails (pre-existing, unrelated).
- PR 2: DIPCore EventRewardPointsTests, DIP build, Preview EventPointsTests (2) passed; audit and review rounds in the PR.
- PR 1: DIPCore ChangeLogTextTests (5), DIP build, Preview ChangeHistoryTests (2) passed; audit and review rounds recorded in the PR.

## Decisions

- The change author is shown as "the organizer" (the log stores a uid or "organizer"; uids are never shown).
- No backend changes in this stream so far; nothing deployed.

## Handoff

All four Stream A PRs are merged into `feature/v2-remaining`. Push needs the paid team and aps-environment before any device test.
