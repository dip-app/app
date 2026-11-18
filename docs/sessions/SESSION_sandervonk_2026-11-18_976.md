# Work session

User: sandervonk
Date: 2026-11-18
Workstream: admin-i18n
Agent: Claude (Opus) with Sonnet helpers
Status: handoff

## Summary

Admin portal phase of #259. Added a dependency-free i18n runtime (typed catalogs per area, `t()` with an ICU subset for
plurals and select, Intl formatting, a pseudo-locale), English, a complete draft Spanish catalog (1,214 keys, 337 of
them Dipbot copy moved from aiStrings.ts into the catalog), a Language section in Your settings (stored in this
browser, no server field) and a guardrail `npm run check:admin-i18n` wired into `npm run check`. Migrated the shared
chrome and the highest-traffic pages (89 files carry `// @i18n-migrated`). English output is unchanged. Seven Sonnet
helpers migrated disjoint areas in parallel (events, editor, overview, members/audit/challenges, Dipbot components,
Dipbot Spanish, shared UI); the lead did the runtime, guardrail, chrome, login, settings and integration.

## Changes

- apps/admin/src/lib/i18n/ (runtime, icu.ts, catalog/en and catalog/es per area), components/I18nProvider.tsx,
  components/LanguageSettings.tsx; AppProvider calls `initLocale()` and wraps the tree in `I18nProvider`.
- aiStrings.ts now reads the catalog (`ai.*`), with Intl plural rules in `tn()`; its English moved to catalog/en/ai.ts.
- Migrated: Shell/nav, AdminOnly, AppProvider boot, error and not-found pages, Ui, useLoad, usePaged, kit, Dialog,
  Tabs, Toast, Toggle, PageSkeletons; login; Your settings; Overview (+ insights, tagStats, tagArt, catalog); Events
  list, new/edit pages, EventForm, EventCard, EventPreview, contract.ts; WhenPicker, when.ts, WhereSection,
  CoverPicker, covers.ts; Members list; Weekly themes and Challenges lists, ChallengeRows, ThemeCard, weeks.ts,
  challenge.ts; Audit log and auditLabels.ts; Dipbot wizard (Ideas, Considerations, IdeasForYou, SuggestionsEmail,
  ideas.ts, credits.ts, suggestions.ts and related).
- `ROLE_LABEL`, `AUDIT_LABELS` and `STEPS` are getter-backed so module-level users follow the language.
- Styles: nav groups use a shrinkable column (long labels ellipsize); phone-card labels (`td[data-label]::before`)
  wrap within 88px. Neither changes English rendering.
- scripts/admin-i18n/check.ts and check.test.ts, scripts/admin-i18n-allowlist.txt, package.json scripts
  `check:admin-i18n` and `test:admin-i18n` (both in `check`).
- docs/design/admin-i18n.md (new), docs/design/ios-i18n.md (link).
- Tests: lib/__tests__/i18n.test.ts, aiStrings.i18n, events.i18n, dipbot.i18n; components/__tests__/LanguageSettings,
  Overview.i18n, editor.i18n, membersAuditChallenges.i18n, ui.i18n; UserSettings test updated (members now see
  Language); tagArt test compares against the catalog.

## Validation

- `npx tsc --noEmit` and `npx eslint src` in apps/admin: clean.
- Targeted vitest (all component tests plus the lib tests for touched modules and the new i18n tests): 57 files,
  561 tests passed. Full suites not run (per owner preference).
- `npm run check:admin-i18n`: OK (1,214 keys in en and es, 89 migrated files). `npm run test:admin-i18n`: 12 pass.
- `python3 scripts/check-docs.py`: OK.
- English unchanged, measured in mock mode with headless Chrome (reduced motion), base commit 0470762f vs this branch,
  full-page at 1440 and 390: Overview, Events, Members, Audit log (and Challenges, Weekly themes at 390). Visible text
  plus every aria-label/title/placeholder identical on all pages. Pixels identical except 26 antialiased pixels on
  Overview 1440 and 2 on Overview 390 ("Day 3 of 7" is now one text node), and 51 on Weekly themes 390, same cause. A
  base-vs-base control run was pixel-identical. One run showed differing audit times because the mock clock rolled
  over a minute between captures; a rerun was identical.
- Spanish and pseudo screenshots (5 pages incl. Your settings, 1440 and 390) reviewed by a fresh design-auditor
  subagent: round 1 FAIL (phone-card labels overlapped values; terminology nits), fixed; round 2 PASS. Two of the
  three remaining nits were applied (shorter "Errores" nav label, "elemento" in the audit search placeholder).

## Decisions

- No i18n framework: static export, client-only, so a typed catalog plus `t()` is lighter; the guardrail imports the
  catalogs directly.
- Language is a browser setting (localStorage) with browser-language fallback; a member locale on the profile is the
  backend phase. Switching re-mounts the signed-in tree.
- Pseudo-locale offered only outside live mode. Klingon not added (not cheap for 1,200 strings).
- Backend text (audit summaries, ApiError messages, mock data), `<head>` metadata and catalog content stay English.
- `lib/considerations.ts` left untouched: it is byte-identical with the server copy.
- The audit CSV now uses the action labels of the current language (getter-backed `AUDIT_LABELS`).

## Handoff

- Follow-up migration: 634 likely UI strings in 12 files (`node --import tsx scripts/admin-i18n/check.ts --remaining`):
  import page and ImportMapping, roster, bug reports, challenge review, member detail, event attendees, event album,
  ThemeForm, ThemePreview, theme edit/new. `ThemeForm` should use `themeTimeZoneLabel()` and `overlapMessage`.
- Native Spanish review of all `es` catalogs (reviewer notes in docs/design/admin-i18n.md).
- Optional: make the phone-card label in-flow (96px grid column) so a three-line label grows the row.
- Backend phase of #259: member locale, server-side message keys for audit summaries and errors, email and push copy.
