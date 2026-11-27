# Reminder and notification emails (stretch S5)

Status: backend implemented behind `EMAIL_ENABLED` (off), nothing deployed, no provider chosen; see [Decisions](#decisions-defaults-taken-while-owner-questions-are-open), the [email contract](../../contracts/email.md) and the [setup runbook](../../ops/email-setup.md). Part of the [V2 stretch goals](../../milestones/v2/STRETCH_GOALS.md). Reuses the category and preference model owned by [push triggers](push-triggers.md) ([notification preferences](notification-preferences.md)).

## Goal and user stories

Send reminder emails and "open in the app" links for the same things that produce pushes, from dynamic templates, with the same per-category switches in profile settings.

- As a member, I get an email when a coworker invites me, when an event I joined changes or is canceled, and (if I choose) a reminder before it starts, each with a button that opens the event in the app.
- As a member without push permission or without the app open, email still reaches me.
- As a member, every optional email has a one-click unsubscribe and a link to my notification settings.
- As an admin, I can trust that emails come from a verified `letsdip.work` sender and never contain chat text or private data.

## Current state (findings)

- No email sending exists anywhere (`gcp/functions` has no mail code). Auth is Google sign-in only (ADR 0007), so every member has a verified Google email on `users/{uid}.email`.
- `letsdip.work` has **no mail DNS records** today and **`support@letsdip.work` does not exist yet**, although the landing pages tell users to write to it (`apps/landing/support/index.html`, `apps/landing/privacy/index.html`). Domain DNS is managed at the registrar ([deploy runbook](../../ops/deploy-runbook.md), DNS section).
- Deep links already exist: universal links `https://letsdip.work/e/<eventId>` with a server-rendered preview page (`eventSharePageV1`, [share links](../share-links.md)). Email buttons should reuse them; non-members land on the preview and the App Store link.
- The notification pipeline (`gcp/functions/src/modules/notifications`) already decides who is notified and why; email should sit behind the same router ([push triggers](push-triggers.md), router) rather than get its own triggers.
- `mvtime/mvtt-server`: **not accessible**. `https://github.com/mvtime/mvtt-server` returned 404 when checked (private or nonexistent), and the public `mvtime` org repos (`mvtime.github.io`, `mvtt-sidebar`) were not inspected for email code (UNVERIFIED). Nothing is confirmed reusable. If the owner wants its template approach reused, share the relevant files or a short description (question 6).
- Privacy policy lists providers (Firebase, Google Cloud, Apple) but no email processor.

## Options considered

### Sending

| Option | Pros | Cons |
| --- | --- | --- |
| Firebase "Trigger Email from Firestore" extension (`firestore-send-email`, v0.2.11, Node 22, Apache-2.0) | Fast to start, Handlebars templates in Firestore, writes a `delivery` status back | Generic SMTP; only SendGrid-specific features; no preference or unsubscribe logic, so we would still write guards; v2 function use UNVERIFIED |
| Provider API from our own function (recommended) | Full control over preferences, idempotency, headers, webhooks; port/adapter keeps provider swappable | We write ~300 lines |

### Providers (about 10,000 emails a month; verify prices at purchase)

| Provider | Free tier | About 10k per month | Notes |
| --- | --- | --- | --- |
| Postmark | 100 per month | $15 (Basic, 10k included) | Strong transactional deliverability, bounce and spam-complaint webhooks, simple JSON API, templates, batch 500, custom headers for List-Unsubscribe; EU region UNVERIFIED |
| Resend | 100 per day, 3,000 per month | $20 (Pro, 50k included) | React-email friendly; bounce, complaint and suppression webhooks; free tier daily cap is tight for a company-wide fan-out |
| Amazon SES | none (credits only) | about $1 | Cheapest; needs sandbox exit, SNS plumbing and our own templates and suppression handling |
| Mailgun | 100 per day | $15 (Basic, 10k included) | US or EU region from one account; webhook details UNVERIFIED |
| SendGrid | UNVERIFIED | UNVERIFIED | Not evaluated; free plan unclear |

**Recommendation: Postmark** for the first version (best fit for notification-style mail, simple API, bounce handling), behind an `EmailProviderPort` so Resend or SES can replace it. Resend is the close second if the team prefers react-email and a free pilot. This needs an owner purchase decision (question 1).

Sender identity: From `DIP <notify@letsdip.work>`, Reply-To `support@letsdip.work`. Use a separate sender or stream for optional reminders versus account-critical mail, as Google advises not mixing categories ([sender guidelines](https://support.google.com/a/answer/81126)).

### Templates

| Engine | Fit |
| --- | --- |
| react-email | Typed React components (props are typed, which suits our TypeScript), preview dev server, dark mode and Tailwind support per its README, provider-agnostic; adds React to the Functions bundle |
| MJML plus Handlebars | Mature responsive layout, no React; no type safety for variables unless we wrap it |
| Plain Handlebars (what the Firebase extension uses) | Simplest; hand-written table HTML |
| Maizzle | Build-time framework, heavier to embed |

**Recommendation: react-email** rendered inside the function (`@react-email/render`) to HTML plus a plain-text alternative, one component per template, shared `Layout`, typed props. If bundling React is unwelcome, MJML plus typed data builders is the fallback. Compatibility with the Node 22 Functions bundle was not verified (UNVERIFIED). Dark mode tips (transparent logos, no pure black or white, `color-scheme` meta, expect clients to override) are general guidance, not verified.

Template catalog (V2): `invite_received`, `invite_answered`, `event_changed`, `event_canceled`, `event_reminder` (24 h, 1 h variants), `challenge_reviewed`, `attendee_added`. Since then: `calendar_invite`, `calendar_cancel`, `admin_suggestions`, the account emails `roster_invite`, `welcome` and `bug_report_resolved` (November 19, 2026), and the opt-in `weekly_theme` and `admin_digest` emails (same day, catalog follow-up). The full list with triggers, defaults and what was deferred is the [email catalog](../email-catalog.md). Variables: member first name, event title, start (localized to the member's time zone if known, else UTC with a label; see question 3), venue name, a coarse cover image (existing catalog art, hosted), CTA URL. No chat text, photos or comments in email.

## Design

### Pipeline

1. A trigger calls `deliverNotification` ([push triggers](push-triggers.md)). The router writes the in-app notice, evaluates preferences, and for the email channel creates an **outbox** document.
2. Outbox: `emailOutbox/{id}` with `id = {category}_{objectId}_{uid}_{revisionOrWindow}` created with `create()` so retries are no-ops. Fields: `uid`, `companyId`, `category`, `template`, `variables` (non-sensitive), `toHash`, `status`, `attempts`, `providerMessageId`, `createdAt`, `expireAt`. Server-only, deny-all rules, Firestore TTL (30 days).
3. `onDocumentCreated emailOutbox` sender: loads the member (email from the server-owned user doc, never from the outbox), checks the suppression list and a company daily cap, renders, sends via the provider port, records `providerMessageId`, and sets `status`. Retries with backoff; permanent failures set `failed` and stop.
4. Provider webhook function (`emailWebhookV1`, HTTPS, signature verified) writes bounces and complaints to `emailSuppressions/{sha256(email)}`; the sender and router honor it and set the member's email preferences off after a complaint.

### Delivery routing with push

Avoid double-notifying for the same thing. Default policy per category: send email when the member has no active device token or push is off for the category; for `invites` and `event_updates` send both (low volume). `reminders` follow the preference with email default off (question 2). The policy lives in the router, not in templates.

### Preferences and unsubscribe

- Preferences: the shared `users/{uid}/settings/notifications` document, `email` map ([push triggers](push-triggers.md)). `chat` and `social` are never emailed.
- Unsubscribe link: `https://letsdip.work/u/<token>` (Hosting rewrite to `emailUnsubscribeV1`). Token is stateless: `base64url(uid.category.expiry).HMAC-SHA256` with a Secret Manager key, so there is no lookup table and no guessable ids. GET shows a confirmation page that turns off that category (and links to in-app settings); POST implements RFC 8058 one-click. Headers on every optional email: `List-Unsubscribe: <https://letsdip.work/u/<token>>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, DKIM-signed; the endpoint must answer the POST directly without redirects, cookies or auth ([RFC 8058](https://datatracker.ietf.org/doc/html/rfc8058)).
- A visible in-body unsubscribe and settings link in the footer.

### Domain setup (owner and infra, needs lead time)

1. Decide the provider and create the account; add the domain.
2. Publish the provider's DKIM records and the SPF include for the sender (and a custom return-path if offered). Google and Yahoo require SPF or DKIM, and from-domain alignment; above 5,000 messages a day to Gmail they also require SPF, DKIM and DMARC and a one-click unsubscribe for marketing and subscribed mail ([Google](https://support.google.com/a/answer/81126), [Yahoo](https://senders.yahooinc.com/best-practices/)). We will be far below that, but follow it from day one.
3. DMARC: `_dmarc.letsdip.work TXT "v=DMARC1; p=none; rua=mailto:dmarc@letsdip.work"`, move to `quarantine` after clean reports.
4. Inbound: create `support@`, `notify@` (replies) and `dmarc@` somewhere. Options: Google Workspace ($7 per user per month for Business Starter, alias support UNVERIFIED), Cloudflare Email Routing (free forwarding, requires Cloudflare DNS, sending-as UNVERIFIED), ImprovMX (free 1 domain and 25 aliases, no SMTP sending), Zoho Mail free (5 users). MX records must be merged carefully with any provider inbound record. Until `support@` exists, the landing pages point at a dead address; fix first (EML-1).
5. Verify with Gmail "Show original" (SPF, DKIM, DMARC pass) and a seed list across Gmail, Outlook and Apple Mail, light and dark.

### Compliance

- CAN-SPAM covers commercial email; transactional or relationship messages, including employment-related information, are largely exempt but may not have false routing or headers ([FTC guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)). Pure event reminders to employees are probably not "commercial" (our inference, not the FTC's). Anything promotional (a `discovery` digest) would be commercial: include the physical address and honor opt-out within 10 business days.
- Owner decision (November 17): no postal address. Every template is transactional (things the member opted into through the notification categories); the footer gives `support@letsdip.work` as the contact. Any future promotional or marketing email would be commercial and would then need a postal address or PO box. A future weekly digest must stay a member-activity summary, opt-in, and not promotional. Honest From and Subject, working unsubscribe for at least 30 days.
- GDPR and ePrivacy: notifications the member opted into are not direct marketing. Document the lawful basis, sign a DPA with the provider, list it as a processor in the privacy policy, and keep email content to the minimum. (GDPR details not researched, UNVERIFIED.)
- Privacy policy edit: add "Emails: we use your Google account email to send the notifications you choose, through <provider>; unsubscribe anytime" and the processor name (shared edit with [calendar](calendar.md)).

## Data model and contract changes

- New server-only collections: `emailOutbox`, `emailSuppressions`; no client access (deny-all falls through).
- Shared preferences doc (owned by [push triggers](push-triggers.md)). Additive schema `NotificationPreferences`; no breaking change.
- New HTTPS functions (not callables): `emailUnsubscribeV1`, `emailWebhookV1`. They are outside the callable contract, so document them in `docs/contracts/` next to the share endpoint.
- Secrets in Secret Manager: provider API key, webhook secret, unsubscribe HMAC key. Never in source or logs.

## Security and privacy

- Tenant isolation: recipient is resolved from `users/{uid}` of the event's company; the outbox stores only ids, no addresses (the address is read at send time). Webhook and unsubscribe endpoints have no auth by design, so they accept only signed or HMAC tokens and do constant-time comparison.
- No chat text, no photos, no comment bodies. Variables are allow-listed per template.
- Logs: message ids, template names, counts. Never the address or body.
- Abuse: per-member daily cap and per-company cap; suppression after complaint; admin cannot compose arbitrary emails in this scope (no broadcast tool).

## Testing plan

- Unit: template rendering (snapshot HTML and text for every template and both reminder windows, long titles, emoji, RTL), variable allow-lists, token sign and verify (tamper, expiry), routing policy matrix.
- Emulator: outbox idempotency (same id twice sends once), suppression honored, preferences off sends nothing, provider fake records the call (mirror `EmulatorOutboxMessaging`), webhook signature checks.
- Manual: deliverability and rendering across clients, one-click unsubscribe from Gmail, DMARC reports.
- Targeted runs only.

## Rollout and flags

`EMAIL_ENABLED` server param (default false) and a per-company `emailEnabled` field (server-owned). Start with internal addresses, then one pilot company, then everyone. Warm up gradually and watch Postmaster Tools for the spam rate. Rollback: flag off; outbox docs expire.

## Risks

Deliverability on a brand-new domain (warm-up, DMARC discipline); cost surprises (caps); duplicate notification fatigue with push; the `mvtime` template reference may not exist publicly; owner time for DNS and mailbox setup is the critical path.

## Open questions for the owner

1. Provider and budget: Postmark (about $15 per month) or Resend ($0 pilot, $20) or SES?
2. Reminder emails: on by default for everyone, or only when push is unavailable?
3. Is there a company time zone to localize times? If not, how should email show times?
4. Business postal address for the footer, and who owns `support@`, `notify@`, `dmarc@` mailboxes?
5. Is `events@letsdip.work` still wanted as a calendar-invite sender, or is `notify@` enough?
6. Can you share the relevant `mvtt-server` template files or describe the approach you liked?
7. React in the Functions bundle (react-email) acceptable?

## Decisions (defaults taken while owner questions are open)

Recorded November 17, 2026 by the email workstream. Each can be revisited; none needs a data migration.

1. **Provider (question 1):** code is provider-agnostic (`EmailProviderPort`, `EmailWebhookVerifier`); the real adapters are Postmark (recommended) and Resend (`EMAIL_PROVIDER=resend`, added while Postmark approval was pending). Default `EMAIL_PROVIDER=log` sends nothing. No account was created and nothing was bought.
2. **Templates (question 7):** no React in the Functions bundle. A small typed, dependency-free renderer (table layout, inline styles, dark-mode media query, Outlook VML button, plain-text alternative) replaced react-email; no new runtime npm dependencies (dev-only checkers: `npm run check:email`, see [email compatibility](../../ops/email-compatibility.md)). Snapshot files live in `gcp/tests/unit/__snapshots__/email/`; `npm run email:preview -- <dir> [--asset-base <url>]` writes a gallery. The look follows the admin site (see the style guide below).
3. **No per-event cover image:** a full-width event photo dominated a notification and Outlook cannot crop. Instead every email carries the same on-brand header and footer art (hosted, 1200 wide shown at 600). The cover variable is still allow-listed for later.
4. **Reminder emails default off (question 2)**, as in the shared registry; members opt in. *Superseded November 22, 2026 (owner decision):* the about-24-hour reminder email is on by default under its own email-only switch `day_before_reminders`; the 1 hour email stays off (`reminders`). See [email coverage](../email-coverage.md#owner-decision-applied-24-hour-reminder-email-on-by-default). `discovery` is offered (default off) but no template exists yet.
5. **Time zone (question 3):** `emailSettings/{companyId}.timeZone` when set, else the `EMAIL_DEFAULT_TIME_ZONE` param (default `America/New_York`, the same assumption as the share page). Every time shows the zone abbreviation.
6. **Postal address (question 4), owner decision:** none. Emails stay transactional; the footer reads "Sent by DIP · Questions? support@letsdip.work", and Reply-To is `support@letsdip.work`. A promotional email would need a postal address first.
7. **Sender (question 5):** `notify@` only (From), `support@` as Reply-To; no `events@`.
8. **mvtt-server (question 6):** not used; nothing was accessible.
9. **Per-company enablement** lives in a new server-only `emailSettings/{companyId}` document rather than a field on `companies/{c}`, so no contract change was needed.
10. **At most once:** an ambiguous provider outcome (timeout, crash, lost lease) is recorded as `unknown` and never resent; a duplicate email is worse than a missing one. Only definite retryable rejections are retried (5 attempts).
11. **Unsubscribe GET does not unsubscribe** (scanners prefetch links); it shows a page whose button POSTs. The RFC 8058 POST from mail clients acts directly. Tokens are per category, valid 365 days, and the page also offers "all DIP emails".
12. **Webhook auth:** Postmark does not sign webhooks, so the endpoint requires Basic credentials (secret password, at least 24 characters, constant-time compare). A complaint suppresses the address and turns every email category off for the member.
13. **ICS:** calendar invites (EML-5, built November 17, 2026) are separate `calendar_invite` and `calendar_cancel` emails with `METHOD:REQUEST` and `METHOD:CANCEL`, see [calendar.md](calendar.md#emailed-invites-cal-8-november-17-2026). The earlier informational `METHOD:PUBLISH` attachment (UID `<eventId>@letsdip.work`) was removed from invite, reminder, change, cancel and attendee-added emails because it created a second calendar entry next to the invite; those emails link to the event page instead.
14. **Opens only, approximate, off by default** (`EMAIL_OPEN_TRACKING`): a signed 1x1 pixel `https://letsdip.work/o/<token>.gif` served by `emailOpenV1` increments `openCount` and sets `firstOpenedAt`/`lastOpenedAt` on that email's own `emailOutbox` document (counters only, no IP, user agent or per-open log). Apple Mail Privacy Protection and Gmail's image proxy prefetch images, so counts overstate real opens and are a rough signal only. **No click tracking**: redirect links would break universal links into the app.
15. **Caps:** 20 emails per member per day and 2,000 per company per day (overridable up to 50,000 in `emailSettings`).
16. **Push-or-email policy:** invites and event updates go to both channels; reminders and discovery follow the email switch only; challenge emails are sent only when push will not be delivered.
17. **Event updated emails** show When and Where with current values and the old value of each changed field struck through directly above it (time-only changes strike only the time, venue name and address independently). Old values come from the event change log, collapsed to the earliest old and latest new value. The venue street address is now included for members (they see it in the app). Updates that change no time, place or title are not emailed.
18. **Account emails (November 19, 2026):** a separate outbox category `account` for transactional emails that are not member notifications: the roster invitation (sent only when an admin clicks Send invite email, to the roster entry's own address, opt-out per address), the one-time welcome and the problem-report-resolved note. No new member switch: unsubscribing from all DIP emails stops the member ones. The weekly theme announcement was deferred because it needs its own default-off category ([email catalog](../email-catalog.md#deferred-and-why)).

## Email style guide

The emails follow the admin site (`apps/admin`, `styles/pro.scss`), not the playful app style.

- **Type:** Figtree for body (fallback `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`), Fjalla One for headings (fallback `Impact, 'Arial Narrow', sans-serif`; Outlook is forced to Arial). Loaded with a Google Fonts `<link>` plus `@import`; Gmail and Outlook ignore web fonts, so the fallback must look right on its own.
- **Color:** ink `#1E212B`, neutral grays with AA contrast, hairline borders, white card on a light neutral page. Purple `#7B88FA` only on the primary button (white text, bold, at least 44px tall). White on `#7B88FA` is about 3.1:1, a locked brand decision; the label is bold 16px to compensate.
- **Borders:** never a one-sided colored border on an element with `border-radius` (the colored edge curves into a crescent). Use a full uniform hairline border, a solid background tint, or a square-cornered accent bar as its own element. A unit test enforces this.
- **Layout:** tables only (`role="presentation"`), inline styles, 600px max width, no `display:flex` or `grid`, no background images for content, bulletproof button with a VML `v:roundrect` fallback, full-width button under 620px.
- **Header and footer:** both are full-bleed bands (100% wide rows in the page color, `#F2F3FC` light and `#121318` dark, with the 600px art centered inside), so wide viewports show no boxed art and dark mode has only two tones (page and card). Each band is ONE transparent image that reads on light, dark and a client's forced inversion: brand-purple clover and Fjalla wordmark (`#5A66E6`), faint purple clouds, and the mascots on their own rounded light panel (their ink outlines need a light ground). No light/dark image swap (polish November 26, 2026; the old `-dark.png` files are kept as copies for emails already sent). The header links to letsdip.work (`alt="DIP"`); the footer banner (`alt=""`) is the very last visible element, after the footer text.
- **Images:** hosted on the site (`apps/admin/public/img/email/`, served at `https://letsdip.work/img/email/`), absolute https URLs, retina (1200 wide shown at 600), `width`/`height` attributes, `alt` on every image (decorative art `alt=""`), `bgcolor` fallback on the image cell so blocked images leave a calm tinted band. See `apps/admin/public/img/email/README.md`.
- **Dark mode:** `color-scheme` and `supported-color-schemes` meta, `prefers-color-scheme` overrides and `[data-ogsc]` for Outlook.com. Gmail apps may invert colors themselves; banners are opaque and self-contained so inversion cannot break them.
- **Content:** hidden preheader (followed by invisible padding so inbox previews stop there; an overlong name or title inside it is shortened with an ellipsis instead of cutting the sentence), one heading, one sentence with the greeting, a When/Where table, one 44px button, a hairline, a three-line footer (reason; Unsubscribe and settings path; "Sent by DIP · Questions? support@letsdip.work"), then the footer banner. Event emails lead with the event: a small uppercase kicker with the state ("Event updated", "Event canceled" in red), then the event title as the Fjalla heading, then the lead and the When/Where table. Times use non-breaking spaces so the zone never orphans. Plain-text alternative carries the same content. US spelling, no em dashes.

Client support notes (from caniemail.com, general guidance, not re-verified per client): `<style>` in `<head>` and media queries work in Apple Mail, iOS Mail, Gmail web and apps (Gmail supports embedded styles but not `@import` web fonts) and Outlook.com; classic Outlook for Windows (Word engine) ignores `border-radius`, `max-width` and web fonts, hence VML buttons, fixed-width tables and the mso Arial override; `prefers-color-scheme` works in Apple Mail and Outlook for macOS, not in Gmail.

## Work breakdown

| ID | Title | Scope | Acceptance | Est | Area | Depends |
| --- | --- | --- | --- | --- | --- | --- |
| EML-1 | Domain and mailbox setup | Choose provider, publish SPF, DKIM and DMARC, create `support@`, `notify@`, `dmarc@` mailboxes or forwards, fix the support and privacy pages | Gmail Show original passes SPF, DKIM and DMARC; mail to `support@` arrives; runbook updated | M | infra | none |
| EML-2 | Provider port and adapters | `EmailProviderPort`, Postmark adapter, emulator outbox fake, secrets wiring | Unit tests with fake; adapter sends in a sandbox account; no secrets in source or logs | M | backend | EML-1 |
| EML-3 | Outbox and sender | `emailOutbox` collection, create-once ids, `onDocumentCreated` sender, retry and failure status, caps, TTL | Emulator tests: duplicate id sends once, caps enforced, failed status recorded | L | backend | EML-2, PUSH-2 |
| EML-4 | Template system | react-email layout and the seven templates with text alternatives, preview script, snapshot tests | Snapshots reviewed in light and dark; every variable allow-listed; deep links use `letsdip.work/e/<id>` | L | backend | EML-2 |
| EML-5 | ICS attachment | Event ICS (`METHOD:PUBLISH` or `REQUEST` decision) attached or linked in reminder and invite emails | ICS imports cleanly in Gmail, Outlook and Apple Mail; UID stable across updates | M | backend | EML-4 |
| EML-6 | Unsubscribe endpoint | `emailUnsubscribeV1` GET and RFC 8058 POST, HMAC tokens, category opt-out write, Hosting rewrite | Tests: tamper, expiry, one-click POST without redirect; preference doc updated | M | backend | PUSH-1 |
| EML-7 | Bounce and complaint webhook | `emailWebhookV1` with signature check, `emailSuppressions`, preference off on complaint | Emulator tests with sample payloads; suppressed address never sent to | M | backend | EML-3 |
| EML-8 | Router email channel | Router writes outbox per preferences and the push or email policy | Matrix tests for category, preference, token, suppression, per-event level | M | backend | EML-3, PUSH-2 |
| EML-9 | Email settings UI | Email section in Profile > Notifications with the allowed categories | View-model tests; toggles persist; chat and social rows absent | S | ios | PUSH-7 |
| EML-10 | Policy, compliance and pilot | Privacy policy processor line, DPA, footer contact, DMARC to quarantine, pilot company | Policy deployed before send; pilot sends reviewed; Postmaster spam rate checked | M | infra | EML-1 |

## Sources

- Trigger Email extension README and manifest: https://github.com/firebase/extensions/blob/next/firestore-send-email/README.md and https://raw.githubusercontent.com/firebase/extensions/next/firestore-send-email/extension.yaml
- Postmark pricing and docs: https://postmarkapp.com/pricing, https://postmarkapp.com/developer/user-guide/send-email-with-api, https://postmarkapp.com/developer/webhooks/bounce-webhook
- Resend pricing and webhooks: https://resend.com/pricing, https://resend.com/docs/dashboard/webhooks/event-types
- Mailgun pricing: https://www.mailgun.com/pricing/
- SES pricing and suppression: https://aws.amazon.com/ses/pricing/, https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html
- Google sender guidelines: https://support.google.com/a/answer/81126
- Yahoo sender best practices: https://senders.yahooinc.com/best-practices/
- One-click unsubscribe: https://datatracker.ietf.org/doc/html/rfc8058
- CAN-SPAM guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- ePrivacy Directive: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32002L0058
- react-email: https://github.com/resend/react-email; MJML: https://github.com/mjmlio/mjml; Maizzle: https://github.com/maizzle/framework
- Inbound options: https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/, https://improvmx.com/pricing/, https://www.zoho.com/mail/zohomail-pricing.html, https://workspace.google.com/pricing
- mvtime org (public repos only): https://github.com/mvtime; `mvtt-server` returned 404.
- Not verified: SendGrid free plan, Mailgun webhooks, Postmark EU region, GDPR details, extension v2 function use, react-email with Node 22 bundles.
