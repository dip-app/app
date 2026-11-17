# Work session

User: sandervonk
Date: 2026-11-17
Workstream: stretch-calendar
Agent: Claude (Opus lead with Sonnet subagents)
Status: completed

## Summary

Built the V2 stretch item S1 "calendar conflicts and one-tap add" (parent #177) from docs/design/stretch/calendar.md: CAL-1 to CAL-7 (#178 to #184). Phase A (conflicts with other DIP events the member joined, no permission) is always on. Phase B (opt-in, on-device EventKit full-access read, direct save with Undo, entry tracking) sits behind `DIP_CALENDAR_CONFLICTS_ENABLED` (Debug YES, Release NO until the privacy page is deployed) and a per-uid Profile toggle. CAL-8 (#185, emailed ICS and webcal feed) depends on the email workstream; only a server-side ICS builder (no sending) is planned as a follow-up PR.

## Changes

- `ui/Packages/DIPCore/Sources/DIPCore/DIPCalendarConflicts.swift` (new): pure overlap engine, ignore rules, DIP conflicts, merge, start-sorted index, overlap text, pill state reducer, fit ordering, per-uid local store, device-calendar port and in-memory fake.
- `ui/Packages/DIPCore/Sources/DIPCore/DIPCalendarEvent.swift`: `calendarFields(eventID:)` writes the share link as the entry URL.
- `ui/DIP/Features/Shared/DIPCalendarModel.swift`, `DIPEventKitDeviceCalendar.swift` (new): app model, environment value, EventKit adapter (window cache, change observer, writes limited to DIP entries), Debug `--calendar-fake=free|conflict|added|off|denied`.
- `ui/DIP/Features/Shared/DIPDetailComponents.swift`, `EventDetails/DIPEventDetailsScreen.swift`, `Challenge/DIPChallengeDetailsScreen.swift`: stateful date pill, "Overlaps with" alert, toast with Undo, opt-in teaser, update offer, leave and remove.
- `ui/DIP/Features/Home/DIPHomeScreen.swift`, `ui/Packages/DIPDesignSystem/.../DIPHomeComponents.swift`, `Prototype/DIPPrototypeApp.swift`: fits-first ordering and an amber badge on overlapping cards.
- `ui/DIP/Features/Profile/DIPProfileScreen.swift`, `Accounts/DIPMemberHome.swift`: CALENDAR section, model per uid, access refresh on foreground, records cleared on sign-out.
- `ui/DesignSystem/tokens.json` plus generated Swift: `warningAmber`, `calendarFree`, `calendarConflict`, `textOnCalendarConflict`.
- `ui/project.yml`, `ui/Config/Base.xcconfig`: full-access usage string and the feature flag.
- `apps/landing/privacy/index.html`, `docs/ops/testflight-universal-links.md`, `docs/design/stretch/calendar.md` (Decisions), `docs/milestones/v2/STRETCH_GOALS.md`.

## Validation

- `swift test --filter CalendarConflictsTests` (DIPCore): 30 tests, 0 failures (includes FakeDeviceCalendarTests). `--filter CalendarEventTests` and `HomeEventsPresentationTests`: pass.
- `swift test` in ui/Packages/DIPDesignSystem: 32 tests, 0 failures. `python3 scripts/generate-tokens.py --check`: clean.
- `xcodegen generate` and `xcodebuild ... -destination 'platform=iOS Simulator,name=Claude-Base' build`: BUILD SUCCEEDED.
- Manual on Claude-Base and Claude-Duo with `--mock-member --calendar-fake=...`: free, conflict (alert), direct add with toast, Undo (entry removed, pill back to free), added, teaser, Profile section, Home badges, Duo detail pane. Screenshots were kept in the session scratchpad only.
- Design crit: round 1 asked for a warning color distinct from the yellow back button and tighter teaser copy; round 2 PASS.
- Not run: full app test suites (targeted tests only by standing instruction); no real-device EventKit run (no device, mock calendars only).

## Decisions

Recorded in docs/design/stretch/calendar.md "Decisions (November 17, 2026)": opt-in full access adopted, Add anyway allowed, solid amber conflict pill (design language: solid = pressable), share link as entry URL, Home sort without a chip, no conflict reminders, no freebusy APIs, no emailed invites here.

## Handoff

- Owner: deploy the privacy page (site deploy), then flip `DIP_CALENDAR_CONFLICTS_ENABLED = YES` for Release in `ui/Config/Base.xcconfig`; App Store privacy label unchanged; add the review note from the ops checklist.
- Real-device checklist in the design doc's Testing plan (permission prompt, revoke mid-session, recurring events, time zone travel) is still to run.
- CAL-8 (#185): emailed ICS attachment and webcal feed belong with the email workstream (EML-5).
