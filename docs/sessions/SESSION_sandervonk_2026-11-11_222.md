# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Fix challenge-submissions integration test hang
Agent: claude
Status: completed

## Summary

`npm run test:challenge-submissions:integration` hung on feature/v2-combined: all tests passed but the Node process never exited, so the emulators:exec wrapper only ended at the outer alarm.

## Changes

- `gcp/tests/integration/challenge-submissions-callable.test.ts`: a `t.after` cleanup deletes the test data and the auth users and closes every client Firebase app and the admin app (open Firestore and Auth handles kept the process alive), like the photos integration test.

## Validation

- Ran the script's emulators (auth, functions, firestore, storage) on alternate ports with `FUNCTIONS_EMULATOR_HOST` set: 5 tests passed and the command exited 0 in about 24 seconds.

## Decisions

- The functions host falls back to 127.0.0.1:5001 when `FUNCTIONS_EMULATOR_HOST` is unset; left as is (same pattern as the other integration tests).

## Handoff

None.
