# Work session

User: sandervonk
Date: 2026-11-01
Workstream: 02-accounts-profile
Agent: Codex with backend, Swift, rules and independent review agents
Status: completed

## Summary

Reviewed and merged PR4's company-membership core, then built a separate V1 account integration MR. Exposed the callable with throttling/App Check, narrow profile/company rules and an observable Swift account boundary. No new onboarding UI was invented or cloud deployment performed.

## Changes

- Integrated backend commit83848ab, Swift67154ed and rulesb72f909, preserving their session logs003/002/004.
- Added real accounts test discovery in Node24 and Node22 CI, serial Auth/Functions/Firestore emulator integration, DIPAccounts package checks and full Firebase SDK app compilation.
- Added lifecycle/queued-identity hardening (39e6999), transaction-boundary limiter fix (36e5c3b) and actual Firestore SDK enum compatibility (eecee7c).
- Fixed XcodeGen Markdown resource duplication, updated current-state/contracts/setup guidance and proposed ADR0006. Generated wire schemas/DTOs are unchanged.

## Validation

- Locked npm ci completed in the final checkout. npm run check passed with37 executable accounts unit tests; the implemented company-joining TODO was replaced by a pointer to them. Six unrelated workflow TODOs remain, not passing features.
- npm run test:rules passed95/95 tests (87 account/profile checks plus8 baseline checks).
- npm run test:accounts:integration passed11/11 tests through actual local Auth/Functions/Firestore emulators, including token refresh, data defaults/replay/conflict, generic wrong-code failure and concurrent throttling. Files run serially because the original adapter tests reset the database.
- npm run test:swift passed13 tests (1 contracts,3 design-system,9 account lifecycle/validation). Full DIP simulator build passed against the actual Firebase SDK after correcting its Firestore error-code enum.
- Independent review found a real minute-boundary limiter race; deterministic delayed-read and clock-rollback regressions now pass. Local docs/session/diff checks complete before publication; CI status is reported on the MR.

## Decisions

- Highest-value V1 unblocker is authenticated membership scope and protected profile access. Keep onboarding design/root composition and production configuration as explicit next work.
- Five validated join attempts per verified UID per server-clock minute, with production App Check, no code logging and no client limiter access. No TTL policy or cloud resource was deployed.
- Profile lists cap at10 after the emulator proved two20-element validations exceed Firestore's expression budget; Swift validation and documentation match. No source schedule or wire-schema claim was fabricated.
- Use a local isolated checkout after filesystem operations stalled in the newly created managed Documents folder. Preserved the integration edits and all author commits; no user edits discarded.

## Handoff

Review the new account integration MR against main (already contains PR4). Use AccountsSession only from configured SDK instances and route private content only for observed member state. Next steps: approved account/company onboarding views, Firebase/App Check startup configuration, tenant-scoped event adapters and physical-device verification. UI PR3 remains separate and has the corrected four-pill photo design. No MR merge, deployment, signing identity or production project was configured by this integration session.
