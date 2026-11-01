# Work session

User: sandervonk
Date: 2026-11-01
Workstream: 02-accounts-profile
Agent: Codex backend integration agent
Status: completed

## Summary

Prepared reviewed joinCompanyV1 deployment export with transactional verified-UID throttling. No deployment or cloud changes.

## Changes

Accounts transport enforces App Check outside the official Functions emulator. Firestore limiter admits five requests per fixed minute, including wrong codes; authentication, verification and request validation precede database access. Added real client Auth/Functions/Firestore emulator coverage and transport guard tests.

## Validation

Node24 npm ci and npm run build passed. Accounts unit tests: 37 passed (including deterministic delayed-read boundary and clock rollback regressions). Auth/Functions/Firestore emulator tests with node --import tsx --test --test-concurrency=1 gcp/tests/integration/accounts*.test.ts: 11 passed. Isolated ports Auth19099, Functions15001, Firestore18080; FUNCTIONS_EMULATOR_HOST overrides default5001. Initial parallel run failed due to the older adapter suite resetting the shared emulator database; sequential execution resolves that fixture conflict. Production Node22 execution remains CI validation; local Functions emulator used host Node24. Parent integrator runs shared contract, rules and Swift checks.

## Decisions

One server-only accountRateLimits/{uid} record contains windowStart, attempts and expiresAt; no codes, email addresses or IP data. expiresAt enables optional future TTL configuration but enforcement does not depend on cleanup. Five requests per fixed minute counts valid joins and replays as well as wrong codes. Following independent review, window selection occurs after the transaction read on each retry; future stored windows fail closed to prevent clock rollback from resetting the budget. Server clock is injectable and rollover/concurrency are tested. Proposed us-central1 stays pending team location decision before deployment.

## Handoff

Parent owns shared documentation, CI/configuration and rules. Deny all client accountRateLimits access. Run combined reset-based integration suites sequentially. Callable tests accept local Auth/Firestore emulator hosts and FUNCTIONS_EMULATOR_HOST (default127.0.0.1:5001), with demo-dip only. Production App Check client setup and real deployment remain pending; no secrets or deployed resources changed.
