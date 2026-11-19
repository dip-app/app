# V2 stretch goals (research and work breakdown)

Written November 16, 2026 from the owner's five stretch requests. These are **stretch items**: they are not part of the committed V2 scope (due December 4, 2026) and nothing here is implemented. Each item has a design doc with options, a recommendation, risks, open questions for the owner and a sub-item breakdown. GitHub issues carry the label `stretch` plus one item label and live on the DIP V2 project board (filter `label:stretch`).

## Index

| # | Item | Label | Design doc | Status | Sub-items |
| --- | --- | --- | --- | --- | --- |
| S1 | Google and device calendar conflicts, one-tap add | `calendar` | [calendar](../../design/stretch/calendar.md) | CAL-1 to CAL-7 built November 17, 2026 (Phase B behind a flag, off in Release until the privacy page deploys); CAL-8 waits on email | CAL-1 to CAL-8 |
| S2 | AI event ideas and prompt-to-event drafts | `ai` | [ai-event-creation](../../design/stretch/ai-event-creation.md) | Built November 17, 2026 (AI-1 to AI-8; admin portal `/ideas/`), off by default and not deployed; drafting on the cheap `gpt-4o-mini` (shutdown January 14, 2027, switch before then), decision checks on TypeSafe AI's Jev by default (falls back to `gpt-4o-mini`, then keyword rules); needs `OPENAI_API_KEY`, `JEV_API_KEY` and a pilot ([runbook](../../ops/ai-events.md)); AI-7 live eval done once (100% valid drafts, about $0.0007 per generation); AI-10 pilot pending, AI-9 deferred | AI-1 to AI-10 |
| S3 | Tag interest counts | `tags` | [tag-interest-counts](../../design/stretch/tag-interest-counts.md) | Built (TAG-1 to TAG-6); not deployed, backfill not run | TAG-1 to TAG-6 |
| S4 | Push triggers and category settings | `push` | [push-triggers](../../design/stretch/push-triggers.md) | Implemented, not deployed: PUSH-1 to PUSH-7 ([notification preferences](../../design/stretch/notification-preferences.md)), plus the [push catalog](../../design/push-catalog.md) additions (admin removed you, photo comments and new photos); PUSH-8 server payload done, iOS actions pending; PUSH-9 blocked on the APNs key and phones ([runbook](../../ops/push-apns-runbook.md), [device verification guide](../../ops/push-device-verification.md)) | PUSH-1 to PUSH-9 |
| S5 | Reminder and notification emails | `email` | [email](../../design/stretch/email.md) | Built behind `EMAIL_ENABLED` (off, not deployed): templates (admin-site style, hosted art), ICS, outbox sender, unsubscribe, webhook, approximate opens, router channel with trigger payloads, Email section in Profile > Notifications; account emails (roster invitation with Send invite email in the portal, welcome, problem report resolved) and the [email catalog](../../design/email-catalog.md) (November 19); owner setup in [email setup](../../ops/email-setup.md) | EML-1 to EML-10 |
| S6 | Admin weekly suggested-events email | `stretch` | [admin-suggestions-email](../../design/stretch/admin-suggestions-email.md) | Built November 17, 2026 behind `EMAIL_ENABLED` and the AI switches (off, not deployed): 50-idea catalog ranked with Jev typed questions (OpenAI mini, then heuristic fallback), hourly company-time-zone scheduler, `admin_suggestions` email category (default off) and template, signed deep links into the event editor, portal `/suggestions/` with preview and test send ([runbook](../../ops/ai-events.md#weekly-ideas-email-s6)) | SUG-1 to SUG-5 (#244) |

Each doc contains a table with `ID | Title | Scope | Acceptance | Est | Area | Depends`; the GitHub sub-issues are generated from those rows. Estimates: S (about half a day or less), M (one to two days), L (three days or more). Area: ios, backend, admin, infra.

## Decisions to make first (summary)

The full lists are in each doc. The ones that unblock the most work:

1. **Tag counts live per company, not on the global tag document** (S3). The global catalog is readable by every tenant, so a count there would leak across companies.
2. **Calendar conflicts read the calendar on the device only, opt-in** (S1). This needs the privacy policy at letsdip.work/privacy to change from "cannot read your calendar". Without it, only DIP-to-DIP conflicts (no permission) are possible.
3. **Email provider and budget** (S5): Postmark (about $15 per month) is recommended; someone must own DNS and the `support@`, `notify@`, `dmarc@` mailboxes. Today `letsdip.work` has no mail records and `support@` does not exist, although the landing pages tell people to write to it.
4. **Notification categories and defaults** (S4 and S5): one shared preference model; confirm the category list and which are on by default.
5. **AI budget, who may use it, and images** (S2): catalog art first; stock or generated covers need a contract decision and written permission.

## Dependencies

```text
S3 tag counts ----------------------------> S2 AI ideas (reads aggregated counts)
S4 category model + router ---------------> S5 email (same categories, preferences, triggers)
S4 push settings screen ------------------> S5 email settings rows
S1 calendar (on device) --- independent --- (no server data; informs UI, not pushes)
S1 email ICS attachment ------------------> needs S5 templates
S4 device verification + APNs key --------> blocks real-device testing of S4 and S5 push parity
```

- S4 and S5 share one **notification category and preference model** (`users/{uid}/settings/notifications`) and one **delivery router**; both are specified in [push-triggers](../../design/stretch/push-triggers.md) and consumed by [email](../../design/stretch/email.md).
- S1 does not feed pushes: the server never sees the calendar, so "event soon" pushes stay independent of conflicts. Conflict warnings are in-app only (the doc explains a possible on-device local notification as a later option).
- S2 needs S3's counts, the existing catalog art, and a company time zone if drafts should carry times.

## Suggested build order

1. **S3 tag counts** (backend S and M items, about a week): small, independent, unlocks S2 and the organizer tag picker.
2. **S4 settings and router, in parallel with owner prerequisites**: PUSH-1 to PUSH-3 and PUSH-7 can be built and emulator-tested now; PUSH-9 (device verification) waits on the paid Apple team and APNs key already tracked on the board ("Push notifications: enable and verify", "[Blocked] Push delivery on a real device").
3. **S1 calendar Phase A then B**: CAL-1 (DIP-only) can start immediately and ships without permissions; CAL-2 to CAL-5 follow after the owner approves the opt-in read. Privacy policy (CAL-7) ships first.
4. **S5 email**: start EML-1 (domain and mailboxes) now in parallel because DNS, warm-up and provider signup have the longest lead time; EML-2 to EML-8 wait for PUSH-2 (router).
5. **S2 AI ideas**: last; needs TAG-6, the owner's budget answer and an evaluation pass (AI-7) before the portal flow is exposed.

If only some items are selected for December 4, the smallest valuable slices are: TAG-1 to TAG-2, CAL-1, PUSH-1 and PUSH-7, and EML-1.

## What the repo already has (read November 16, 2026)

| Area | Exists | Where |
| --- | --- | --- |
| Add to calendar | Write-only, permissionless system event editor, all-day floating-day logic, past and cancelled hiding, header pill on the event page; `NSCalendarsWriteOnlyAccessUsageDescription` declared; privacy page says "cannot read your calendar" | `ui/DIP/Features/Shared/DIPEventCalendar.swift`, `ui/Packages/DIPCore/Sources/DIPCore/DIPCalendarEvent.swift`, `ui/project.yml`, `apps/landing/privacy/index.html` |
| Push backend | Device registry, `sendPush`, chat, event-change, RSVP and reminder (24 h, 1 h) triggers, invite push, per-event levels (`all`, `changes`, `reminders`, `none`); not deployed | `gcp/functions/src/modules/notifications`, `modules/invites` |
| Push client | Flagged off, registrar, priming after first RSVP, deep links, level menu in the chat; device-unverified; needs paid team and APNs key | [push client](../../design/push-client.md), `ui/DIP/Domain/Push` |
| In-app notifications | Center with kinds invite, event updated and cancelled, reminder, challenge approved and changes requested, attendee added, comment, photo; permission banner | `ui/DIP/Features/Notifications`, `users/{uid}/notifications` |
| Tags and interests | Global read-only `tags/{tagId}`; members write `interestTagIds` directly; admin portal mirrors a constant tag list; no counts, no admin tag editor | `gcp/firestore.rules`, `apps/admin/src/lib/catalog.ts` |
| Event creation | `createEventV1`/`updateEventV1` with `EventDraft`; covers limited to five `catalog://default/*` values; nine weekly-theme art keys on a separate allow-list | `gcp/functions/src/modules/organizer`, [theme catalog](../../design/theme-catalog.md) |
| Admin permissions | `can(role, permission)` matrix, audit log, request-id idempotency, rate limit | [admin contract](../../contracts/admin.md) |
| Conventions | Firebase v2 `onCall` in `us-central1`, App Check enforced outside the emulator, versioned `V1` names, additive contract changes only, thin transport and application services | [callables](../../contracts/callables.md), root `AGENTS.md` |
| Share and deep links | `https://letsdip.work/e/<id>` with preview page and universal links | [share links](../../design/share-links.md) |
| Email | Nothing at research time. Since November 17: `modules/email` (off by default), still no mail DNS and no `support@` mailbox | `gcp/functions/src/modules/email`, [email contract](../../contracts/email.md) |
| AI | Nothing. No AI provider code or secret | n/a |

## Existing board cards related to these items

The project board already has draft cards "Push notifications: enable and verify" and "[Blocked] Push delivery on a real device". The push stretch issues depend on them and do not duplicate them. No existing card covers calendar conflicts, tag counts, AI event ideas or email.

## Contract and review notes

- `contracts/v1/models.schema.json` is a shared choke point. Every addition in these docs is additive within v1 (new types, new callables, new optional fields); renaming or removing a stored field, or changing what an existing field accepts for old clients, needs a new contract version and a migration plan. The one place that approaches this is a new `coverImageURL` scheme (AI-9); it is flagged for contract-owner review.
- Rules and indexes are also choke points: assign one integrator when TAG-1, PUSH-1 and AI-1 land.
- Nothing is deployed from this work. Secrets (OpenAI key, Jev key, email provider key, webhook and unsubscribe keys) go in Secret Manager, never in source.
- Pending tests do not count toward V2 coverage targets.

## How to filter on GitHub

- Issues: `label:stretch` (all), plus `label:calendar`, `label:ai`, `label:tags`, `label:push`, `label:email`.
- Project board "DIP V2": add the filter `label:stretch` in the view's filter bar, or group by Parent issue. The project API cannot always create saved views, so see the session log for what was done.

## Additional stretch items (added November 17)

- **Internationalization** ([#259](https://github.com/dip-app/app/issues/259)): move all app, admin, email and push strings to a proper i18n setup (String Catalogs on iOS, a message-catalog library in the portal, per-recipient locale for email and push). For now AI copy lives in one strings module with a single brand-name constant (Dipbot) so it is migration-ready; no i18n library yet. **iOS phase done (November 18):** String Catalogs for the app and every package with copy, plurals, locale-aware formatting, a complete Spanish draft (needs native review), a Klingon demo locale and the `check:ios-i18n` guardrail; see [iOS internationalization](../../design/ios-i18n.md). **Admin portal phase done** (see [admin internationalization](../../design/admin-i18n.md)). **Backend phase:** a server-owned member locale (`setMyLocaleV1`), per-recipient email and push copy in English and Spanish, and stable keys for audit summaries and typed errors; see [backend internationalization](../../design/backend-i18n.md). Remaining: in-app notices, iOS setting the member locale, and the items listed there.
- **AI model migration** ([#260](https://github.com/dip-app/app/issues/260)): OpenAI shuts down `gpt-4o-mini` and `gpt-4.1-mini` on January 14, 2027. Pick a similar-cost, similar-quality replacement (OpenAI suggests `gpt-6-luna`), re-run the eval once and update the budget estimates before that date.
