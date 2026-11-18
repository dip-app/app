# Work session

User: sandervonk
Date: 2026-11-18
Workstream: whenpicker-ci-tests
Agent: Claude
Status: completed

## Summary

Fixed 8 WhenPicker test failures in CI (admin build and accounts-integration). Root cause: the tests set process.env.TZ in beforeAll, but module-level fixtures (NOW, START, END via localToIso) were built at import time, before beforeAll, in the runner's UTC zone. Passed locally only because the laptop zone was already Eastern.


## Changes

- apps/admin/test/globalSetup.ts (new): pins TZ=America/New_York before workers start.
- apps/admin/vitest.config.ts: registers the globalSetup.
- apps/admin/src/lib/__tests__/when.test.ts, apps/admin/src/components/__tests__/WhenPicker.test.tsx: removed the late beforeAll TZ assignment.
- No product code changes. No other admin tests use new Date()/Date.now().


## Validation

- cd apps/admin; TZ=UTC, TZ=America/New_York, TZ=Asia/Tokyo npx vitest run: 366 passed, 2 skipped each. npx tsc --noEmit and npx eslint . clean.


## Decisions

- Global setup over per-file env so any module-level date is built in the pinned zone.


## Handoff

Watch main CI (admin build, accounts-integration) after merge.

