# Work session

User: sandervonk
Date: 2026-11-17
Workstream: email-resend-adapter
Agent: Claude
Status: completed

## Summary

Added a Resend email provider and Svix webhook verifier beside Postmark so email can go live with whichever provider is approved first. Nothing deployed, no account created, no secret values set, no real send.

## Changes

- gcp/functions/src/modules/email/infrastructure/resendProvider.ts (new): ResendProvider (plain fetch, Idempotency-Key = outbox id, reply_to, headers incl. List-Unsubscribe, base64 ics attachment, tags template and outbox_id) and ResendWebhookVerifier (Svix HMAC-SHA256, timingSafeEqual, 5 minute window).
- gcp/functions/src/modules/email/transport/emailFunctions.ts: EMAIL_PROVIDER=resend selects the adapter and verifier; RESEND_API_KEY and RESEND_WEBHOOK_SECRET defineSecrets bound only in onEmailOutboxCreated and emailWebhookV1.
- gcp/tests/unit/email-resend.test.ts (new): local HTTP fake of the Resend API and signature tests.
- docs: email-setup.md (If using Resend instead), email-runbook.md (secrets, section 10), contracts/email.md, design/stretch/email.md, secrets.md, CURRENT_STATE.md.

## Validation

- node --import tsx --test gcp/tests/unit/email-resend.test.ts email-postmark.test.ts email-webhook.test.ts: 72 passed.
- npx tsc --noEmit in gcp/functions: clean.
- npm run check:email: No errors.
- Not run: full suites, emulator integration, deploy (targeted tests only).

## Decisions

- 5xx is retryable because the idempotency key makes a repeat safe; 409 invalid_idempotent_request is unknown (never resent); timeouts stay unknown (at most once).
- Only bounce type Permanent suppresses; Transient, Undetermined and delivery_delayed are ignored.
- Resend webhooks carry tags not metadata, so the outbox id is the tag outbox_id.
- Firebase cannot bind secrets conditionally, so both providers' secrets need placeholder values before deploy.
- The emulator and EMAIL_PROVIDER=log keep the Postmark Basic verifier (existing integration tests unchanged).

## Handoff

Owner: create Resend account, add domain and DNS records, store RESEND_API_KEY and RESEND_WEBHOOK_SECRET with scripts/add-secret.sh (placeholders for the unused provider), then set EMAIL_PROVIDER=resend. Free plan is 100 per day: keep company dailyCap at or below 100. Webhook payload fields were taken from the Resend docs and need a "send test" check after setup.
