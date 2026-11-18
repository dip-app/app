# Work session

User: sandervonk
Date: 2026-11-18
Workstream: event-when-picker
Agent: Claude
Status: completed

## Summary

Replaced the two native datetime-local inputs in the event editor with WhenPicker: a two-click month range calendar plus a 12-hour clock dial (draggable start/end handles, arc, duration, typed fallback fields, AM/PM toggles, presets).

## Changes

- apps/admin/src/lib/when.ts (pure logic), apps/admin/src/components/WhenPicker.tsx, apps/admin/src/styles/_when.scss (+ one @use in pro.scss)
- apps/admin/src/components/EventForm.tsx: minimal wiring; new events default to the next full hour for 1 hour.
- Tests: lib/__tests__/when.test.ts, components/__tests__/WhenPicker.test.tsx.

## Validation

vitest on the two new files (44 tests), tsc --noEmit, eslint src: all pass. Manual mock-mode checks at 1440 and 390 widths. Design audit round 2: PASS (conditional).

## Decisions

Stored ISO values and the local-time conversion are unchanged. End before start on a single day rolls to the next day unless the one-day range was picked deliberately, in which case it is blocked and snapped to +15 minutes. Past days are blocked for new events only.

## Handoff

Open polish from the audit: handle spacing at very short spans, 28px AM/PM segments on fine pointers. Full suites were not run (targeted tests only).
