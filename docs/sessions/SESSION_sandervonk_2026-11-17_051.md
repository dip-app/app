# Work session

User: sandervonk
Date: 2026-11-17
Workstream: stretch-email
Agent: Claude Opus (email lead) with Sonnet subagents
Status: handoff

## Summary

Built the V2 stretch email channel (issue #214, EML-2 to EML-7 backend, EML-1 and EML-10 runbook and policy parts) behind `EMAIL_ENABLED` (off). Adapted to the push workstream's shared category and preference model (PUSH-1, #228) instead of a separate one. Nothing deployed, no account created, no email sent.

## Changes

- `gcp/functions/src/modules/email/**`: domain (category view over the shared registry, routing policy on `evaluateDelivery`, outbox ids and statuses, HMAC unsubscribe tokens, typed templates and renderer, ICS), application (ports, enqueue and router channel, at-most-once sender, unsubscribe handler, webhook processing), infrastructure (Postmark adapter and webhook verifier, emulator and log providers, Firestore stores), transport (`onEmailOutboxCreated`, `emailUnsubscribeV1`, `emailWebhookV1`, params and secrets), preview script.
- `gcp/functions/src/index.ts`: exports the three functions.
- `firebase.json`: Hosting rewrite `/u/**` to `emailUnsubscribeV1`.
- `gcp/firestore.rules`: comment only (new collections fall through deny-all).
- `package.json`: `email:preview`, `test:email:integration`.
- Tests: `gcp/tests/unit/email-*.test.ts` plus snapshots, `gcp/tests/integration/email-outbox.test.ts`, `gcp/tests/rules/email.test.ts`.
- Docs: `docs/contracts/email.md`, `docs/ops/email-setup.md`, Decisions in `docs/design/stretch/email.md`, `docs/ops/README.md`, `docs/milestones/v2/STRETCH_GOALS.md`, `CURRENT_STATE.md`; privacy page email section in `apps/landing/privacy/index.html`.

## Validation

- `cd gcp/functions && npx tsc --noEmit`: clean.
- `node --import tsx --test gcp/tests/unit/email-*.test.ts`: 129 pass, 0 fail.
- `npm run test:email:integration` (emulators: real trigger, unsubscribe and webhook functions): 8 of 8 passed before the shared-registry refactor; rerun after it recorded in the PR.
- `firebase emulators:exec --only firestore,storage "node --import tsx --test gcp/tests/rules/email.test.ts"`: 3 of 3 (needed `NODE_PATH` to a checkout with `@firebase/rules-unit-testing`; CI uses `npm ci`).
- `npm run test:docs`, `npm run check:generated`: pass. Full suites not run (targeted tests only).
- Design crit of rendered emails with an auditor subagent: FAIL then PASS after fixes (no hero image, wordmark header, compact footer, VML button).

## Decisions

See `docs/design/stretch/email.md#decisions-defaults-taken-while-owner-questions-are-open` (16 items): Postmark adapter with log default, no React, no cover image, reminder emails default off, `America/New_York` default zone with labels, postal address param gates sending, `emailSettings/{companyId}` per-company switch, at-most-once sending, GET never unsubscribes, Basic-auth webhook, ICS `METHOD:PUBLISH`, no tracking, caps 20 per member and 2,000 per company per day.

## Handoff

- EML-8 (router email channel): `emailChannel` and `emailChannelDependencies` are ready; the hook in `deliverNotification` (comment placeholder in PR #229) and per-trigger email payloads wait for PUSH-2/PUSH-3 to merge.
- EML-9 (email rows in Profile > Notifications): waits for the push workstream's settings screen (PUSH-7); reuse it, do not duplicate.
- Owner: provider account, DNS (DKIM, Return-Path, DMARC), mailboxes `support@`, `notify@`, `dmarc@`, three Secret Manager secrets (must exist before the next functions deploy), params, DPA, provider name in the privacy page, pilot. All in `docs/ops/email-setup.md`.
- Not verified: real provider sends, real mail clients, Postmark webhook payloads beyond documented shapes.
