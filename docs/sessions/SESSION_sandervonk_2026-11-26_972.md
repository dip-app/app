# Work session

User: sandervonk
Date: 2026-11-26
Workstream: ios-polish-2
Agent: Claude (Opus), with fresh Opus design reviewers
Status: handoff

## Summary

iOS polish program, wave 2 (screen level), stacked on wave 1 (#363). Relative event dates on cards, a facts line and a clamped description on the event page, quieter secondary and destructive actions, a single solid control in the notifications sheet with swipe to mark read, Home section header without the colon, Sign out as a destructive text action, and a shorter bar fade. Findings come from `docs/design/polish-2026-11/ios.md` (DYN-1, EVT-1, NOT-1, TYPE-1, VIS-3 and wave-1 reviewer P3s).

## Changes

- DIPCore: new `DIPEventDateText` ("Today, 7:30 PM", "Tomorrow, 7:30 PM", weekday within six days, else "Nov 30, 7:30 PM", year only outside the current year; locale-aware) used by `DIPEventLists` card lines (memories keep the absolute date) and the live adapter (`MemberEventAppRepository` drops its own badge formatter); `EventDateTextTests`; `EventListsTests` updated.
- Event page: facts line under the title (time range, venue, cost or points; the header pill keeps the day), description clamped to three lines with Read more / Show less (VoiceOver reads the full text), "See what changed" and "Leave Activity" as `DIPTextActionRow` (new shared feature component, 44 pt, destructive in error red).
- Notifications: Invitations stays the one solid control; Mark all as read is a text action on the first day header; unread rows can be swiped left to mark read (horizontal drags only; VoiceOver keeps the row action).
- Home: "Attended Your Recent Events" without the colon. Profile: Sign out as a destructive text action. `DIPEdgeFade.barFadeLength` 36 to 24 pt.
- String catalogs synced; Spanish for every new key.

## Validation

- `xcodebuild build` (DIP scheme, Debug, Claude-Base, shared scratch DerivedData) succeeded after each change.
- `swift test --package-path ui/Packages/DIPCore --filter "EventDateTextTests|EventListsTests"`: 14 tests, 0 failures.
- `npm run ios:i18n-sync` then `npm run check:ios-i18n`: OK (1130 keys).
- Design review (fresh Opus reviewer each round): round 1 FAIL on one P2 (the facts line repeated the header pill's date in another format; now the time range only, formatted per time so a midnight crossing does not add dates); round 2 FAIL on one P2 (the longer header pushed Invite and Share under the bottom button; the description now clamps to three lines and the facts line is tighter, so the people row and its actions stay above the bar at the default size); round 3 FAIL on one P2 that was a stale capture of the cancelled page taken before the three-line change, recaptured and verified at three lines.
- Preview target: `xcodebuild build` of the `Preview` scheme (`ui/ComponentPreview`) after the last change.
- Not run: full suites, `npm run check`, UI tests (owner rule: targeted tests only).

## Decisions

- The header pill owns the day; the facts line owns time, place and cost, so no fact appears twice.
- Past events keep absolute dates with the year (memories), upcoming ones read relative to now.
- Swipe to mark read uses the existing per-notification mark-read command; no new backend call.

## Handoff

- Open from the audit: AX3 card chips (A11Y-1), Duo profile and folded carousel (DUO-1 profile, DUO-2), contrast proposals for the owner (CON-1), failed upload tiles (VIS-7), photo viewer pill (VIS-4), onboarding interests art (VIS-6), pull to refresh on more lists (IX-3), section header style beyond the colon (TYPE-1).
- Reviewer P3s not taken: "Earned 25 points" vs "Earn +50 points" sign, no cancelled marker in the facts line, the clamp can end on a single letter, Read more sits slightly loose under the text.
