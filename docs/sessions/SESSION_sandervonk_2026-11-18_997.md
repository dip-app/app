# Work session

User: sandervonk
Date: 2026-11-18
Workstream: places-test-flake
Agent: Claude
Status: completed

## Summary

Fixed the intermittent functions-runtime CI failure in the Places tests. Failed job logs (run 44367844808 attempt 1, and an earlier run) show the "GooglePlaces adapter" suite failing with `Promise resolution is still pending but the event loop has already resolved` on "errors are typed and never leak the token, URL or body"; the next subtests in the suite were then reported cancelledByParent. Root cause: the timeout case uses a fake fetch that only waits for the request signal to abort, and the signal comes from `AbortSignal.timeout()`, whose timer is unref'd in Node. With nothing else holding the event loop open (runner timing dependent), the process can exit with the promise pending. Confirmed in plain Node: `AbortSignal.timeout(50)` plus a never-resolving promise exits without the abort event firing. The production adapter is unaffected (a real fetch holds a socket).

## Changes

- gcp/tests/unit/helpers/keepAlive.ts: new `keepAliveUntilAbort(signal)` holding a ref'd interval until the signal aborts.
- gcp/tests/unit/places.test.ts, covers-live-infra.test.ts, email-resend.test.ts, email-postmark.test.ts: hanging fake fetches (the same pattern) call it. No assertion changed or weakened.

## Validation

- `node --import tsx --test` on places, covers-live-infra, email-resend, email-postmark: 134 pass, 0 fail.
- Earlier, unchanged places.test.ts and the full `npm run test --workspace @dip/functions` suite (1481 tests) passed repeatedly locally, also under heavy CPU load, so the flake does not reproduce locally; the cause is established from the CI logs and the plain-Node exit check.
- No full suites run after the change (targeted only).

## Decisions

- Fixed in the tests, not the adapter: a ref'd timer in production code is not needed and would change nothing for real fetches.
- Applied to the other three tests with the identical abort-only fake fetch rather than leave the same latent flake.

## Handoff

None. If `AbortSignal.timeout` is used with a new abort-only fake fetch in tests, use `keepAliveUntilAbort`.
