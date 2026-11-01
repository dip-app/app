# Work session

User: sandervonk
Date: 2026-11-01
Workstream: 02-accounts-profile
Agent: Codex GPT-6
Status: handoff

## Summary

Implemented the narrow V1 accounts/profile rules slice on feature/v1-account-rules for integrator review. No deployment, push, or PR.

## Changes

- gcp/firestore.rules: verified self-only user get, including missing documents for onboarding; no user list/create/delete. Own profile updates allow displayName, photoURL, avatarId, department, jobTitle, city, interestTagIds, travelRadiusMiles, availability. Reject persisted id/unknown fields and preserve membership, role, email, balance, createdAt, friends, and favorites.
- Profile validation: displayName trimmed/nonempty, maximum 80; photoURL maximum 2048; other strings maximum 120; radius integer 0..500; interests/availability maximum 10 nonempty strings of maximum 120 each. No invented tag or availability vocabulary.
- Own-company document get requires verified server membership and fails closed if joinCode exists. No company list. Verified tags catalog reads only. All other Firestore and Storage access remains denied.
- gcp/tests/rules/accounts-profile.test.ts: comprehensive self/missing-listener, verified-auth, private profile, admin escalation, immutable fields, every bounded list position, company isolation, legacy code, private collection and out-of-scope denial tests. Baseline unchanged.

## Validation

- npm ci --ignore-scripts passed using cached Node 24.22.1.
- npm run test:rules passed: 95 tests, zero failures, on local demo-dip Firestore/Storage emulators (8080/9199), Java 22. Sandbox binding restriction required approved local execution.
- A prior 20-item-per-list validation exceeded Firestore's 1000-expression budget; reduced both lists to 10 and verified the maximum valid lengths plus invalid values in each position.
- npm run check passed (generated contracts/tokens, session/docs/contracts checks, Functions build and unit suite). Existing placeholder TODO tests remain pending and are not feature coverage.
- Swift checks not run: no Swift files changed; integrator runs integrated checks.

## Decisions

- Minimal company get only; rules cannot hide joinCode inside an otherwise readable document. Trusted tooling must migrate legacy company documents before they become readable.
- friendIds/favoritePhotoIds remain immutable because their features are outside V1. Direct profile updates cannot grant membership or privileges, even for admins.
- Additional field constraints are defensive client-write limits, not changes to canonical schema or semantic catalog vocabularies. UI must respect them.

## Handoff

Integrator owns STATUS/shared documentation and combined feature checks. Review these limits against profile UI before release. Cherry-pick this branch's commit; no deploy requested. Other event/RSVP rules must remain denied until their reviewed feature slice lands.
