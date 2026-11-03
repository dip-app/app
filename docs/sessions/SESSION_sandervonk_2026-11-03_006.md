# Work session

User: sandervonk
Date: 2026-11-03
Workstream: 03-events-participation
Agent: Claude Sonnet 5.5
Status: handoff

## Summary

Event page now follows Figma 46:1397 more closely and a challenge page (Figma 160:6357) was added. Both use shared detail components.

## Changes

- Shared `DIPDetailComponents`: header, hero, people row ("+ N More" pill) and a Join/Leave + Share row.
- Event page: Join Activity sits beside Share Event; when joined the same slot shows Leave Activity (the invented "You're going" label is removed); "View attendees" replaced by the design's "+ N More" pill.
- Challenge page: `DIPChallengeDetailsScreen`, `DIPChallengeDetail` model, `DIPRepository.setChallengeJoined` (default implementation refuses; mock implements it), fixture "Running", Home challenge card routes to it, `--screen=challenge` launch scenario.

## Validation

- DIPCore package tests: 34 pass (adds ChallengeTests). Simulator build succeeds; event and challenge pages checked in the Simulator against the frames.
- UI tests (ConversationFlowTests, PastEventFlowTests, ScreenFlowTests) run separately; see PR for results.

## Decisions

- "Add Your Entry" and the completed-people list are not connected (challenge entries are V2); they use the existing "not connected yet" notice.
- Challenge join state is mock-only; there is no backend command for challenges.

## Handoff

Connect challenge data and entries when the challenge backend exists. The login/loading screen ("Just a moment…") still shows the DIP pill and left-aligned layout; it was not part of this change.
