# Backend internationalization

The backend phase of issue [#259](https://github.com/dip-app/app/issues/259) localizes what the server writes: emails,
push notifications, and the stable keys behind audit summaries and typed errors. It follows the iOS
([ios-i18n.md](ios-i18n.md)) and admin portal ([admin-i18n.md](admin-i18n.md)) decisions:

- English (US) is the source, and existing English emails and pushes stay byte-identical.
- Spanish (`es`) is the first translation: neutral Latin American Spanish with informal "tú". The owner accepted the
  Spanish, so no native review is pending for this phase.
- Server and user content is never translated: event titles, names, chat text, theme titles and idea text.
- There are no provider names in copy, and no right-to-left work.

## Member language

`users/{uid}.locale` is an optional field, either `"en"` or `"es"` (`AppUser.locale` in the contract). It is
**server-owned**. Clients cannot write it, because the Firestore profile update allow-list leaves it out. The only
writer is the callable `setMyLocaleV1`:

| | |
| --- | --- |
| Request | `SetMyLocaleRequest` `{ contractVersion: 1, locale: "en" \| "es" }` (any other field, a uid or companyId included, is `VALIDATION_FAILED`) |
| Response | `SetMyLocaleResponse` `{ contractVersion: 1, locale, changed }` |
| Caller | Signed in with Google and a verified email (`UNAUTHENTICATED`, `EMAIL_NOT_VERIFIED`, `PROVIDER_NOT_ALLOWED`), with a company membership (`MEMBERSHIP_CONFLICT`) that is not deactivated (`ACCOUNT_DEACTIVATED`) |
| Write | One transaction on the caller's own `users/{uid}` that merges `{ locale }` and nothing else. The same value again is a no-op (`changed: false`). |

The server derives nothing on its own: there is no browser, device or email-domain guess. A missing, unknown or
malformed value means English (`localeOrDefault` in `gcp/functions/src/modules/i18n/domain/locale.ts`).

`validProfile` in `gcp/firestore.rules` now lists `locale` as an allowed stored key. Without it, a member with a saved
locale could no longer update their own profile from the app. The client update allow-list is unchanged, so `locale`
stays server-owned. Emulator tests are in `gcp/tests/rules/accounts-profile.test.ts`.

Who sets it:

- **Admin portal.** Your settings > Language saves English or Español through `setMyLocaleV1` when signed in live.
  "Same as this browser" and the pseudo-locale are never sent. On load and sign-in, a saved member locale is preferred
  over the browser default, and localStorage stays the fallback and offline store.
- **iOS (0.1.2).** The app sends its own language. On sign-in and when the app comes to the foreground it maps the
  app's preferred localization to `en` or `es` (anything else, the Klingon demo locale included, is `en`), compares it
  with the profile's `locale` (absent means `en`) and calls `setMyLocaleV1` only when they differ, at most once per
  member and language in a launch. It shows nothing and logs nothing; a failure is retried at the next launch
  (`MemberLocaleSync` in DIPAccounts, adapter in `FirebaseAccountsRepository`). The app language therefore wins over a
  value saved from the portal the next time the member opens the app.

## Runtime

`gcp/functions/src/modules/i18n` is a small shared domain module with no dependencies:

| File | Role |
| --- | --- |
| `domain/locale.ts` | `SUPPORTED_LOCALES`, `localeOrDefault`, `intlTag` (en -> `en-US`, es -> `es-419`) |
| `domain/icu.ts` | The admin portal's ICU subset: `{slot}`, `plural` (with `#` and `=n`), and `select` |
| `domain/catalog.ts` | `translator(catalogs)` -> `t(locale, key, vars)`, `splitAround` (subject prefix and suffix around `{title}`), and `checkCatalogs` (the guardrail) |
| `domain/errorMessages.ts` | `ERROR_MESSAGES` (key -> English) and `errorMessageDetails(message)` |

Each module that sends copy has typed catalogs. English is declared `as const`, and Spanish is typed
`Record<keyof typeof en, string>`, so tsc fails on a missing key.

| Catalog | Keys | Used by |
| --- | --- | --- |
| `modules/email/domain/templates/i18n/{en,es}.ts` | 93 `email.*` | every template (`copy.ts`, `render.ts`, `adminSuggestions.ts`) and the calendar file (`ics.ts`) |
| `modules/notifications/domain/i18n/{en,es}.ts` | 43 `push.*` | the push builders (`domain/push.ts`), the change summary (`summarizeChanges`) and the in-app notice copy (`domain/notices.ts`, `push.notice.*`) |

## Email

- **Templates.** Every template takes the recipient locale from `RenderContext.locale`. This covers invites, invite
  answers, event updates and cancellations, attendee added, reminders, calendar invites and cancellations, challenge
  reviews and the weekly ideas email for admins.
- **Recipient locale.** `sendOutboxEmail` reads `users/{uid}.locale` with the recipient at send time (the
  `RecipientDirectory`) and renders in that language. The outbox holds one document per recipient, so a fan-out with
  mixed languages sends each member their own copy. Nothing new is stored in the outbox.
- **Our copy.** Subjects (only the server title is shortened), preheaders, headings, the greeting, card labels
  (When/Where, Cuándo/Dónde), badges, buttons and the footer are localized. The calendar file text is localized too:
  the `DESCRIPTION` link line and the alarm. The support address and footer links are unchanged.
- **`<html lang>`.** It follows the locale.
- **Dates and times.** These go through Intl with `intlTag(locale)` and the company time zone (existing logic).
  Examples: "Fri, Nov 20, 7:30 PM to 9:00 PM EST" and "vie, 20 nov, 7:30 p.m. a 9:00 p.m. EST". The zone abbreviation
  stays the US English one in every language ("EST", not "GMT-5").
- **Plurals.** Challenge points ("+1 point", "+1 punto") and the ideas count use ICU plurals. English keeps a `{slot}`
  wherever the old code printed a raw number, so numbers are not regrouped.
- **Change lists.** English keeps its own list join ("time, location, and title"). Other languages use
  `Intl.ListFormat` ("la hora, el lugar y el título").
- **Weekly ideas email.** The stored `weekLabel` is English text, so Spanish derives the week from `weekKey` ("semana
  del 30 de noviembre"). The fixed "little data yet" note is mapped to Spanish (`ES_STORED_TEXT`). The idea titles,
  pitches, facts, reasons and when-hints are catalog content and stay as written.
- **Admin preview.** It renders in the admin's own locale (`Actor.locale`).

**Evidence that English did not change.** The golden snapshots in `gcp/tests/unit/__snapshots__/email/*.{html,txt}`
were not touched by this change and still pass. A unit test also renders every preview case with an explicit `en` and
with no locale, and compares them. Spanish has its own golden files in `__snapshots__/email/es/`: all 28 cases plus one
without a first name. `npm run check:email` checks all 57 renders. Its plain-text unsubscribe rule now accepts the
catalog word for each shipped language.

## Push

Every push builder takes a trailing `locale` (default `en`) and reads its titles, bodies, fallbacks ("A coworker") and
reminder phrases from the push catalog. The data payload, thread, collapse id, category and expiry are identical in
every language.

`NotificationRequest` has an optional `pushFor(locale)`. Router-mode triggers set `push: build("en")` and
`pushFor: build`. They cover chat, event change, reminder, invite, invite answered, attendee added, challenge reviewed
and weekly theme.

After the preference and rate-limit gates, `deliverNotification` reads the locales of the recipients it will actually
send to (`LocaleReader`, `FirestoreLocales`: one `getAll` with a `locale` field mask). It then groups their device
tokens and sends one multicast per language.

Failure handling:

- A failed locale read logs a warning with ids and counts only, and everyone gets English.
- A failing localized builder sends English to that language group.
- Without `pushFor` or a reader, the router behaves exactly as before.

English pushes are pinned byte-for-byte in `gcp/tests/unit/push-i18n.test.ts`. This includes the old "in 1 minutes"
reminder wording, kept on purpose.

## Audit summaries and typed errors

**Audit entries.** These carry `summaryKey` and `summaryParams` next to the English `summary`, which is unchanged for
older clients. This is additive in the contract: `AuditEntry.summaryKey` and `AuditSummaryParam[]`, with numbers sent
as decimal strings.

- The keys are listed in `gcp/functions/src/modules/admin/domain/auditSummaries.ts`: 47 keys covering every summary
  written today.
- Params hold server or user content (names, emails, titles, counts).
- Fallback words such as "a member" use an ICU `select`, so they are translated too.
- The admin portal shows the stored `summary` in English, and `audit.summary.<key>` from its catalog in other
  languages. Old entries without a key always show `summary`.
- The CSV export stays English, because it is a file format.

**Typed errors.** These keep `reason`, `fields` and the English `message`, and now also send `details.messageKey` and,
when needed, `details.messageParams`.

- `ERROR_MESSAGES` maps 107 keys to the exact English messages of the admin, organizer, challenges, submissions, AI,
  covers, places and suggestions errors.
- `errorMessageDetails` finds the key by the exact English text, plus one parameterized form: "At most {max} rows per
  import."
- Internal errors send `errors.generic`.
- In the portal, `apiErrorFrom` turns the key into the active language's message for toasts, inline notices and field
  errors. English keeps the server text.

## Guardrail

`npm run check:backend-i18n` (`scripts/backend-i18n/check.ts`) runs inside `npm run check`. It fails when:

- a Spanish email or push key is missing, empty, does not parse, has placeholders that differ from English, or has a
  plural without a `one` form;
- a catalog key is never used in the module source, or the code uses a key in a catalog namespace that the catalog
  lacks (`email.reason.*`, `email.ideas.fit.*` and `push.change.label.*` are built from data);
- a server error key or audit summary key is missing from the portal's English or Spanish catalog, or the portal's
  English error text differs from the server's;
- a literal typed-error message in the portal-facing modules is not in `ERROR_MESSAGES`;
- a `summaryKey` used in code is not in `AUDIT_SUMMARY_KEYS`.

Unit tests are `npm run test:backend-i18n` (the script and `portalKeys.ts`), plus `gcp/tests/unit/email-i18n.test.ts`,
`push-i18n.test.ts`, `accounts-set-locale.test.ts` and `i18n-audit-errors.test.ts`. They cover locale selection,
fallback, plurals, and that sending uses each recipient's locale, including mixed locales in one send.

## Adding a language

1. Add the code to `SUPPORTED_LOCALES` and `INTL_TAG` in `modules/i18n/domain/locale.ts`, to `AppUser.locale` and
   `SetMyLocaleRequest.locale` in the contract (an additive enum value), and run `npm run generate`.
2. Add a catalog per module (`email`, `push`) and the portal's `errors` and `audit.summary.*` entries.
3. Add it to `SERVER_CATALOGS` in `scripts/backend-i18n/check.ts`, and add golden email snapshots.

## What remains

- **In-app notices** (`users/{uid}/notifications`) follow the recipient's locale since November 22 (router notices
  through `inAppFor`; invite, attendee added and challenge approved from their commands). Still English: the attendee
  removed notice, the "Changes needed" notice and notices written before the change. Details in
  [push-catalog.md](push-catalog.md#notification-text-language-november-22-2026).
- **The legacy push path** (`PUSH_ROUTER_ENABLED=false`, a rollback switch) and its invite push stay English.
- **Weekly ideas content** (idea titles, pitches, facts, reasons and when-hints) is English catalog content.
- **Error keys are not yet sent** by the accounts (`resolveMembershipV1`), invites, participation, photos and
  notifications callables. The iOS app reads its own copy for those reasons. The `INVALID_STORED_*` internals also have
  no keys, because they are always shown as the generic message.
- **Audit params with enum values** stay as stored: bug report statuses in "(open to triaged)" and the field names in
  "Updated Mia: role, teamIds".
- **Mock-mode data** in the admin portal stays English.
- **iOS** sets the locale from the app language (above) but has no in-app language setting.
