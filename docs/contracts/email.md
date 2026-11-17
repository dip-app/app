# Email endpoints and server-only collections

Implementation of [reminder and notification emails](../design/stretch/email.md) in `gcp/functions/src/modules/email`. None of this is a callable and none of it is in `contracts/v1/models.schema.json`: the HTTP endpoints are public pages and a provider webhook, and the collections are server-only. The member-facing preference document is the shared `NotificationPreferences` contract ([notification preferences](../design/stretch/notification-preferences.md)). Nothing is deployed; setup is in the [email setup runbook](../ops/email-setup.md).

## Functions

| Name | Kind | Purpose |
| --- | --- | --- |
| `onEmailOutboxCreated` | Firestore `onDocumentCreated` on `emailOutbox/{id}`, `retry: true` | Runs every send-time gate and sends at most once |
| `emailUnsubscribeV1` | HTTPS, public, Hosting rewrite `/u/**` | Unsubscribe confirmation page and RFC 8058 one-click POST |
| `emailOutboxReaper` | Scheduled, every 15 minutes, `maxInstances: 1`, `retryCount: 0` | Closes outbox documents the trigger cannot finish: `sending` with an ended lease -> `unknown`/`abandoned` (never resent); `queued` for over 1 hour -> `failed`/`stale_queued`. At most 200 per status per run; logs the warning `email.reaper` with counts |
| `emailWebhookV1` | HTTPS, public, direct function URL | Provider bounce, complaint and subscription-change webhook |
| `emailOpenV1` | HTTPS, public, Hosting rewrite `/o/**` | Approximate open counter (1x1 GIF), only when `EMAIL_OPEN_TRACKING` is on |

Router integration (EML-8): `deliverNotification` accepts an optional `request.email` payload `{ template, variables, objectId, revisionOrWindow, notAfter? }` and an optional `deps.email` port. Wire it as `email: routerEmailChannel(emailChannelDependencies())` (both exported from `modules/email`). Per recipient, after the push decision, the channel applies the shared `evaluateDelivery` (channel `email`), the company switch and the push-or-email policy, rejects a template whose category differs from the notification kind's, validates the variables and creates the outbox entry once. Failures never block the push. Triggers start sending emails when they are migrated onto the router with an `email` payload (PUSH-3).

## `GET|HEAD|POST /u/<token>`

- Token: `base64url("v1:" + uid + ":" + category + ":" + expirySeconds) + "." + base64url(HMAC-SHA256(EMAIL_UNSUBSCRIBE_KEY, "dip-email-unsubscribe." + payloadPart))`, valid 365 days (so one-click keeps working for as long as mail is kept), one category per token. Verified in constant time before parsing.
- GET/HEAD: 200 confirmation page with two buttons (this category, or all DIP emails). It never changes preferences, because link scanners prefetch GETs.
- POST with body `List-Unsubscribe=One-Click` (RFC 8058, what Gmail and Yahoo send) turns the token's category off; `scope=all` turns every email category off. Writes `users/{uid}/settings/notifications` with a merge `{ contractVersion: 1, email: { <category>: false }, updatedAt: serverTimestamp }`. 200, idempotent, and the same page when the member no longer exists.
- Invalid, tampered or expired token, or a POST with neither field: 400 with one generic page (no oracle). Other methods: 405.
- Never redirects, never sets cookies, no auth. Headers: `Cache-Control: no-store`, `X-Robots-Tag: noindex`, a restrictive CSP, `Referrer-Policy: no-referrer`.

## `POST emailWebhookV1`

- Auth: HTTP Basic, username `dip-email-webhook`, password `EMAIL_WEBHOOK_PASSWORD` (at least 24 characters, else every request is 401), compared in constant time. 401 on failure, 400 for oversize (256 KB) or invalid JSON, 405 for other methods.
- Postmark payloads (single object or array): `HardBounce`, `BadEmailAddress`, `ManuallyDeactivated` -> suppression `hard_bounce`; `SpamComplaint` and `SpamNotification` -> suppression `complaint` plus every email category off for the member (uid from the outbox document named in `Metadata.outboxId`, else up to 5 members with that address); `SubscriptionChange` with `SuppressSending` -> suppression `provider_unsubscribe`; soft bounces and deliveries are ignored.
- A batch of more than 500 events is refused with 413 (nothing processed) so the provider retries; an item that is not an object is skipped and counted (`malformed` in the processed log), the rest are processed; a body whose every item is malformed is 400.
- 200 `ok` after processing, 500 on a store error so the provider retries (all writes are idempotent). Webhook logs carry `outboxId` and `providerMessageId` only, never addresses, tokens or names.

## `GET|HEAD /o/<token>.gif`

- Token: `base64url("v1:" + outboxId + ":" + expirySeconds) + "." + HMAC-SHA256(EMAIL_UNSUBSCRIBE_KEY, "dip-email-open." + payloadPart)`, valid 90 days. The distinct prefix means an open token can never act as an unsubscribe token or the reverse.
- Always 200 with the same 43-byte transparent GIF and `Cache-Control: no-store`, for valid and invalid tokens alike; no cookies, no redirects. A valid token on a `sent` email increments `openCount`, sets `firstOpenedAt` once and `lastOpenedAt` (transaction), but only while `openCount` is below 20; later replays do not write. Nothing else is stored (no IP, no user agent).
- Accuracy: Apple Mail Privacy Protection and Gmail's image proxy fetch images without a human opening the email, and blocked images hide real opens. Treat counts as approximate.

## Server-only collections (deny-all rules)

| Path | Fields | Notes |
| --- | --- | --- |
| `emailOutbox/{category_objectId_uid_revisionOrWindow}` | `uid`, `companyId`, `category`, `template`, `variables` (allow-listed per template), `status` (`queued`, `sending`, `sent`, `failed`, `skipped`, `expired`, `unknown`), `reason`, `attempts`, `notAfter`, `leaseUntil`, `providerMessageId`, `toHash`, `sentAt`, `openCount`, `firstOpenedAt`, `lastOpenedAt`, `createdAt`, `updatedAt`, `expireAt` (TTL, 30 days) | Created once with `create()`; never stores an address |
| `emailSuppressions/{sha256(lowercased address)}` | `reason`, `createdAt`, `lastEventAt`, `count` | Checked before every send |
| `emailCaps/{member_<uid>_<day> or company_<companyId>_<day>}` | `count`, `expireAt` (TTL) | Daily caps: 20 per member, `dailyCap` per company (default 2,000). Consumption is idempotent per outbox email through a marker document `cap_<uid>_<day>_<outboxId>` (`uid`, `day`, `expireAt`) created in the same transaction, so retries of one email consume one unit |
| `emailSettings/{companyId}` | `enabled` (bool), `dailyCap` (int, at most 50,000), `timeZone` (IANA, optional) | Missing means email is off for the company. Written by an operator in the console |
| `emulatorEmailOutbox/{auto}` | `toHash`, `subject`, `template`, `outboxId`, headers, attachment names, sizes | Emulator only, replaces the provider |

## Send-time gates (in order)

claim (lease) -> `notAfter` -> `EMAIL_ENABLED` -> unsubscribe key configured -> variables pass the template allow-list -> company enabled -> member exists, same company, active, has an email -> email switch for the category -> address not suppressed -> daily caps -> render, sign the unsubscribe link, send.

At most once: a send whose outcome is unknown (timeout, crash, abandoned lease) is never retried. Only a definite retryable rejection (429, 503, connection refused before sending) returns the document to `queued` and lets the runtime redeliver, up to 5 attempts. The same applies to any failure before the provider is called (store reads, cap transaction, claim): reason `transient_error`, `failed` once attempts are exhausted. A failure after the provider call is `unknown`. The reaper (above) closes anything left behind.

## Every email

- From `DIP <notify@letsdip.work>`, Reply-To `support@letsdip.work`, Postmark stream `notifications`, Postmark's own open and link tracking off (our optional pixel is the only open signal).
- Headers `List-Unsubscribe: <https://letsdip.work/u/<token>>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Footer: reason; Unsubscribe and "Manage in DIP: Profile > Notifications"; "Sent by DIP · Questions? support@letsdip.work" (mailto). No postal address (transactional mail only).
- Links: `https://letsdip.work/e/<eventId>` for events (universal link, preview page for non-members), `https://letsdip.work/` otherwise.
- An `event.ics` attachment (`METHOD:PUBLISH`, UID `<eventId>@letsdip.work`, `SEQUENCE` = event revision) on invites, reminders, changes, cancellations (`STATUS:CANCELLED`) and attendee-added emails.
- Never: chat text, comments, photos, other members' email addresses, venue coordinates. The venue name and street address appear only in emails to members of the event's company, who already see them in the app.
- Event updated: When and Where always show current values; a changed field shows its old value struck through directly above the new one (inline `<del>` with a hidden "was" for screen readers). An update that changes no time, place or title is not emailed.
