# Work session

User: sandervonk
Date: 2026-11-18
Workstream: backend-i18n
Agent: Claude Opus 5.5 (with two Sonnet subagents on separate files: push, and audit/error keys plus the portal)
Status: completed

## Summary

This session did the backend phase of issue #259: server-written copy in each member's language.

- **Member language.** `users/{uid}.locale` is a new server-owned field (`en` or `es`). It is set by the new
  `setMyLocaleV1` callable and by the admin portal's Language setting.
- **Emails.** All templates, subjects and the calendar file text are rendered per recipient from typed en/es catalogs.
- **Push.** Titles and bodies are localized per recipient in the router.
- **Audit and errors.** Audit summaries and typed errors carry stable keys and params, which the admin portal renders
  in the active language.
- **Guardrail.** `npm run check:backend-i18n` is part of `npm run check`.
- **English is byte-identical.** The English email snapshots were not modified, and the English push strings are
  pinned in tests.

## Changes

- **Contracts.** `contracts/v1/models.schema.json` gains these, all additive and optional:
  - `AppUser.locale`
  - `AuditEntry.summaryKey` and `summaryParams`
  - `AuditSummaryParam`
  - `SetMyLocaleRequest` and `SetMyLocaleResponse`

  The generated TS and Swift files are regenerated, and `contracts/tests/i18n.test.mjs` is new.
- **Shared module.** `gcp/functions/src/modules/i18n` is new: locale, an ICU subset copied from the portal, the typed
  `translator`, `checkCatalogs`, and `errorMessages`.
- **Accounts.** `setMyLocaleV1` is new in `application/setMyLocale.ts`, `infrastructure/firestoreLocaleStore.ts` and
  `transport/setMyLocaleV1.ts`. It is exported from `src/index.ts`.
- **Rules.** `gcp/firestore.rules` adds `locale` to the `validProfile` stored-key list. It stays out of the client
  update allow-list. `gcp/tests/rules/accounts-profile.test.ts` has a new test for this.
- **Email.**
  - Catalogs in `templates/i18n/{en,es,index}.ts`.
  - `copy.ts`, `render.ts`, `adminSuggestions.ts`, `layout.ts` (`lang`), `ics.ts`, `types.ts` (`RenderContext.locale`).
  - `sendOutboxEmail.ts`, `ports.ts` and `firestoreEmailStore.ts` read and pass the recipient locale.
  - `previewCases.ts` (`PREVIEW_CASES_ES`) and `preview.ts`.
  - `tools/emailCompat` (Spanish renders, and an unsubscribe rule that knows the language).
  - New Spanish golden files in `gcp/tests/unit/__snapshots__/email/es/`.
- **Push** (subagent).
  - Catalogs in `notifications/domain/i18n/`.
  - Locale-aware builders in `push.ts` and `summarizeChanges`.
  - The router gets `pushFor` and a `LocaleReader` (`FirestoreLocales`, wired in `routerDeps.ts`).
  - Router-mode handlers, `newTriggers` and `invitePushNotifier` pass the localized builder.
  - Later, the main session made a failing localized builder fall back to English per locale group.
- **Audit and errors** (subagent).
  - `admin/domain/auditSummaries.ts` (47 keys), and `audit.ts` writes `summaryKey` and `summaryParams`.
  - Every audit summary call site now passes a key, with the English unchanged.
  - The admin, organizer, challenges and submissions error mappers add `details.messageKey`.
  - `Actor.locale` renders the ideas email preview in the admin's language.
- **Admin portal** (subagent).
  - New `errors` catalog area (107 keys, en and es) and `audit.summary.*` entries.
  - `apiErrorFrom` localizes messages outside English, and the audit page uses `auditSummary()`.
  - `LanguageSettings` calls `setMyLocaleV1`, and `applyMemberLocale` runs on load and sign-in.
  - `DYNAMIC_PREFIXES` in `scripts/admin-i18n/check.ts` is updated.
- **Guardrail.** `scripts/backend-i18n/{check,portalKeys}.ts` and their tests. `package.json` adds
  `check:backend-i18n` and `test:backend-i18n`, both inside `check`.
- **Tests.** New: `gcp/tests/unit/{email-i18n,push-i18n,accounts-set-locale,i18n-audit-errors}.test.ts`. Updated:
  `email-templates.test.ts` (Spanish snapshots), and `ai-credits.test.ts` and `challenges.test.ts` (which now expect
  `messageKey`).
- **Docs.** `docs/design/backend-i18n.md` is new. Also updated: `admin-i18n.md`, `ios-i18n.md`,
  `docs/contracts/{callables,data-ownership,email}.md`, `docs/milestones/v2/STRETCH_GOALS.md` and `CURRENT_STATE.md`.

## Validation

- `npm run check:generated` passes, and so does `npm run test:contracts` (62/62).
- `npm run check:admin-i18n` passes, `npm run test:admin-i18n` passes 12/12, `npm run check:backend-i18n` passes, and
  `npm run test:backend-i18n` passes 4/4.
- `npm run check:email` reports no errors across 57 renders: 28 English and 29 Spanish.
- `npx tsc --noEmit -p gcp/functions` is clean.
- **Targeted unit tests** (from `gcp/functions`, `node --import tsx --test`): 1160 tests, 1154 pass, 0 fail, the rest
  skipped. The files were:
  - `admin-*`, `notifications*`, `notificationEmailPayloads`, `push-i18n`, `email-*`, `accounts-*`,
    `i18n-audit-errors`, `invites`, `suggestions-*`, `organizer-events`, `challenge*`, `places`
  - `ai-application`, `ai-ideas-application`, `ai-credits`, `covers-live-application`, `rsvp-profile-snapshot`
  - `gcp/functions/tests/unit/*`
- **Email snapshots.** The English ones in `__snapshots__/email/*.html|txt` have no git diff, and the Spanish ones are
  new.
- **Firestore rules emulator.** `accounts-profile.test.ts` passes 77/77. Port 8080 was held by another session's
  emulator, so this ran on a temporary config with port 8188. The temporary files were deleted.
- **Swift.** `swift test --package-path ui/Packages/DIPContracts` passes 1/1, and `.build` was removed afterwards.
- **Admin portal** (subagent): `npx tsc --noEmit`, `npx eslint src`, and vitest on 9 files (114/114) all pass. After
  that, `apps/admin/node_modules` was removed.
- **Not run:** the whole unit suite (`npm run test:unit`), the emulator integration suites, and an Xcode build. The
  app code did not change; only the generated models did.

## Decisions

- **Member locale.** It is server-owned, and a new small callable sets it rather than a client rule, so clients still
  cannot write anything new. A missing or unsupported value means English, and the server guesses nothing.
- **English identity.**
  - In the portal, English shows the stored English `summary` and the server error `message` unchanged. Other languages
    use the catalog.
  - The email footer keeps the support address and links.
  - The time zone abbreviation stays en-US ("EST") in every language.
  - Push English keeps the old "in 1 minutes" wording.
- **Spanish email leads.** Spanish leads are capitalized after "¡Hola, Sam!". The changed fields read "Hay cambios en la
  hora y el lugar", which avoids verb agreement.
- **Ideas email.** The stored `weekLabel` is English, so Spanish derives the week from `weekKey`. The fixed "little
  data" note is mapped to Spanish, and the idea content stays as written.
- **Push fallbacks.** Push localization is router-only. The legacy rollback path stays English. A locale read or
  builder failure falls back to English and never fails delivery.

## Handoff

The remaining work is listed in `docs/design/backend-i18n.md` under "What remains":

- In-app notices are still English.
- The legacy push path is still English.
- Weekly ideas content (titles, pitches, facts, reasons and when-hints) is still English.
- Accounts, invites, participation, photos and notifications errors carry no message keys yet.
- Enum values inside audit params stay as stored.
- Mock-mode data is still English.
- iOS does not call `setMyLocaleV1` yet.

Deploying needs `setMyLocaleV1` and the updated Firestore rules to ship together, because the `validProfile` change
must be live before any member has a locale.
