# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Optimistic join and leave
Agent: Claude Code
Status: active

## Summary

Join and leave now flip the UI at once and roll back only if the server refuses, after a local reasonableness check mirroring setRsvpV1. Full events keep the disabled "Activity full" bar.

## Changes

- DIPCore: DIPParticipationRules (join/leave denials) and DIPOptimisticRSVP (begin, succeed, fail, observe; latest intent wins), ParticipationRulesTests.
- ui/DIP/Data/Events/MemberEventAppRepository.swift: setRSVP is optimistic with per-event pending state overlaid on joined state and attendee count (so Home, event page, My Events and Profile agree), rollback on failure.
- ui/DIP/Features/Prototype/DIPPrototypeApp.swift: local check before the flip, success haptic at tap, failure haptic and message on denial or rollback.
- FRONTEND_PLAN ledger row 21.

## Validation

- DIPCore ParticipationRulesTests: 6 tests passed. DIP scheme compile only; no UI or repository suites rerun (owner instruction).
- Not verified: behaviour against the real setRsvpV1, double-tap timing on a device.

## Decisions

- Double taps are blocked by the existing in-flight command guard; the reducer also handles a newer intent replacing an older request if one is ever issued.
- "Activity full" wording stays (owner correction); the disabled `.complete` bar style is covered by EventBarActionTests.

## Handoff

Change history, push registration and the theme page remain on hold.
