# Work session

User: sandervonk
Date: 2026-11-17
Workstream: backend-quality-audit
Agent: Claude Sonnet (audit fixer)
Status: completed

## Summary

Fixed the verified email module audit findings: pre-send failures no longer lose the email, claim failures are retried, a scheduled reaper closes stuck outbox documents, the daily cap is consumed once per outbox email, unsubscribe links last 365 days, the webhook no longer drops or rejects whole batches silently, and open-pixel writes are bounded.

## Changes

- gcp/functions/src/modules/email/application/sendOutboxEmail.ts: claim errors rethrown as RetryableEmailError; errors before the provider call requeue with reason transient_error (failed at MAX_ATTEMPTS), only post-provider errors become unknown.
- gcp/functions/src/modules/email/application/reapOutbox.ts (new), ports.ts (OutboxReaper, cap consume takes outboxId, parse result malformed count), infrastructure/firestoreEmailStore.ts (reaper adapter, cap marker document, bounded recordOpen), transport/emailFunctions.ts (emailOutboxReaper schedule, memory on the outbox trigger), index.ts exports.
- application/webhook.ts and infrastructure/postmarkProvider.ts: 413 above 500 events, malformed items skipped and counted, correlation ids in logs.
- domain/outbox.ts (constants, canCountOpen), domain/unsubscribeToken.ts (365 days).
- Tests: email-sender, email-webhook, email-postmark, email-unsubscribe, new email-reaper.
- Docs: docs/contracts/email.md, docs/ops/email-setup.md, docs/design/stretch/email.md.

## Validation

- cd gcp/functions && node --import tsx --test ../tests/unit/email-*.test.ts ../tests/unit/notificationEmailPayloads.test.ts: 209 pass, 0 fail.
- npm run build (tsc): clean.
- npm run test:email:integration: not run to completion, Firestore emulator port 8080 was taken by another process.

## Decisions

- Stale queued documents are marked failed (stale_queued) because an onCreate trigger cannot be re-run.
- The sending reaper pass uses a single-field range on leaseUntil (no composite index); the stale queued pass needs the composite index emailOutbox(status, createdAt), listed in the PR. firestore.indexes.json was not edited.
- Cap idempotency uses a marker document cap_{uid}_{day}_{outboxId} created in the cap transaction.
- A webhook body with only malformed items stays 400; a mixed batch is processed.

## Handoff

- Add the composite index (see PR) and an alert on the email.reaper log warning.
- Run the email integration suite where the emulators can start.
