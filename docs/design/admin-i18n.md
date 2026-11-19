# Admin portal internationalization

The admin portal (`apps/admin`, Next.js static export under `/admin/`) is internationalized with a small in-house
runtime and typed message catalogs (issue [#259](https://github.com/dip-app/app/issues/259), admin phase). It mirrors
the iOS decisions in [ios-i18n.md](ios-i18n.md): English (US) is the source and must look identical to before,
Spanish (`es`) is the first translation, there is no right-to-left work, and server or user content is never
translated.

## Why no framework

The portal is a static export of client components with no server at runtime, so locale routing (`/es/...`) and
server-side message loading buy nothing. The AI features already kept their copy in one keyed module
(`src/lib/aiStrings.ts`). The runtime builds on that: about 200 lines, no dependency, and the guardrail script can
import the catalogs and the message parser directly.

## Files

| Path | Role |
| --- | --- |
| `src/lib/i18n/index.ts` | Runtime: current locale, `t()`, `setLocalePreference()`, `initLocale()`, Intl helpers, `BRAND` |
| `src/lib/i18n/icu.ts` | ICU message subset: `{slot}`, `plural` (with `#` and `=n`), `select`; the pseudo-locale transform |
| `src/lib/i18n/catalog/en/<area>.ts` | English source, one file per area; keys start with the area name |
| `src/lib/i18n/catalog/es/<area>.ts` | Spanish, typed `Record<keyof typeof source, string>` so tsc fails on a missing key |
| `src/lib/i18n/catalog/{en,es}/ai.ts` | Dipbot copy, served as `ai.<key>` and read through `aiStrings.ts` (`t`, `tn`, `tMaybe`) |
| `src/components/I18nProvider.tsx` | `useLocale()` and the provider that re-mounts the signed-in tree on a language change |
| `src/components/LanguageSettings.tsx` | The Language section of Your settings |
| `scripts/admin-i18n/check.ts` | Guardrail (`npm run check:admin-i18n`, part of `npm run check`) |
| `scripts/admin-i18n-allowlist.txt` | Reviewed guardrail exceptions (`file<TAB>text`) |

Areas: `common`, `shell`, `ui`, `login`, `account`, `events`, `editor`, `dipbot`, `overview`, `members`, `audit`,
`challenges`, `importer` (`import.*`), `roster`, `bugs`, `review`, `memberDetail`, `attendees` (`attendees.*` and
`album.*`), `themeForm`, `ai`. 1,842 keys in total (337 of them `ai.*`).

To add an area, create `en/<area>.ts` and `es/<area>.ts` and spread both into the two `index.ts` files.

## Language selection

The portal picks:

1. The signed-in member's saved language (`users/{uid}.locale`, server-owned), applied at load and sign-in.
2. Otherwise the choice in Your settings > Language, stored in this browser (`localStorage["dip.admin.locale"]`).
3. Otherwise the first browser language the portal ships (`es-MX` and `es` pick Spanish), else English.

Picking English or Español in Your settings while signed in live also saves it on the profile through `setMyLocaleV1`
([backend-i18n.md](backend-i18n.md)), so emails and pushes follow it. "Same as this browser" and the pseudo-locale are
never sent, and a failed save keeps the local choice silently.

`AppProvider` calls `initLocale()` before any signed-in content renders, and the static HTML is only the boot screen,
so there is no flash of English and no hydration mismatch. `setLocalePreference()` updates `<html lang>` and
re-mounts the signed-in tree (`I18nProvider`), so every string, including ones computed in helpers, switches at once.
Local component state on the page is lost on a switch, which is acceptable on the settings page. The toast store
outlives the re-mount, so "Language saved." shows in the new language.

## Languages

- **en** (source).
- **es** (complete draft): neutral Latin American Spanish with informal "tú". **It needs review by a native speaker
  before release.** Glossary follows iOS (evento, actividad, reto, tema semanal, participación, puntos, Ajustes) plus:
  miembro, organizador, administrador, lista de personal (roster), registro de auditoría, borrador (draft), créditos,
  lugar (venue), Resumen (Overview), Errores (Bug reports), Elemento (audit target), Cupo lleno (Full),
  agregar (not añadir). Notes for the reviewer: `ai.ideasForYou.fitSpoken`, `ai.consider.selected.*` (feminine),
  `ai.step.note.label` ("Pregunta"), `ai.setting.offsite`, `ai.where.limit`, `ai.goal.team_bonding`.
- **pseudo** (layout test): every English message with accented letters, doubled vowels and padding (about 2x),
  wrapped in ⟦ ⟧. Slots, plurals and the brand stay intact, dates stay en-US. It is offered in the picker only
  outside live mode (mock and local builds).
- **tlh (Klingon)** was not added: the iOS novelty locale needed a full hand translation, which is not cheap for 1,200
  admin strings. The runtime would take it as one more catalog with English fallback.

Plurals: Spanish needs `one` and `other`; its CLDR `many` category falls back to `other`.

## Guardrail

`npm run check:admin-i18n` fails on:

- Spanish keys that are missing, empty or not in English, and messages that do not parse;
- placeholder mismatches between English and Spanish (slot names and plural/select arguments), and Spanish plurals
  without a `one` form;
- keys passed to `t`/`tn` (either module, aliases included) that are not in the catalog, and catalog keys nothing uses
  (keys built from data are covered by template-literal prefixes or `DYNAMIC_PREFIXES`);
- in migrated files: JSX text, UI attributes (`aria-label`, `title`, `placeholder`, `label`, ...), strings rendered in
  JSX expressions, label-like object properties, `toast()`/`ApiError` messages, fixed `"en-US"` formatting and
  `t()` at module scope. Comparisons (`phase === "loading"`) and strings that are catalog keys are ignored.

Reviewed exceptions go in `scripts/admin-i18n-allowlist.txt`; `--update-allowlist` rewrites it from the current
findings (review the diff). `--remaining` lists likely UI strings in files not yet migrated. Unit tests:
`npm run test:admin-i18n` (guardrail) and `apps/admin/src/lib/__tests__/i18n.test.ts` (runtime).

## What is migrated

Everything in the signed-in portal. Shared chrome (Shell and navigation, boot and error pages, kit components, dialogs,
tabs, toasts, skeletons, load states, AdminOnly), sign-in, Overview, Events list and the event editor, Event attendees
and Event album, Members list and Member detail, Roster, Import people (page, column mapping and the validation
messages in `importFile.ts` / `importMapping.ts`), Bug reports, Review submissions, Weekly themes (list, ThemeForm,
ThemePreview, new and edit), Challenges list, Audit log, the Dipbot wizard and Ideas for you, the weekly ideas email
settings, and Your settings with the Language section. 103 files carry the marker.

`npm run check:admin-i18n -- --remaining` is at zero. It skips `SERVER_CONTENT_FILES` in `scripts/admin-i18n/check.ts`:
the mock backend and API adapters (`adminMock.ts`, `api.ts`, `firebaseAdapter.ts`, `ideasMock.ts`,
`ideasForYouMock.ts`), `considerations.ts` (byte-identical with the server copy) and the language names in
`i18n/index.ts` (endonyms by design). Those are server content until the backend phase.

Left in English on purpose: CSV file contents that are file formats (import template and error report headers, the
attendee export), "Copy as issue text" in Bug reports (pasted into an issue tracker), and the Review and Attendees
point counts that never pluralized ("1 points").

## Evidence that English did not change

Mock mode, Chrome headless over the DevTools protocol with reduced motion and a fixed clock, admin persona, base commit
vs. the branch at 1440 and 390 px. Pages: Import, Roster, Bug reports, Review submissions, Member detail, Event
attendees, Event album, New theme and Edit theme (9 pages, 18 captures). The visible text (`innerText`) and every
`aria-label`, `title`, `placeholder` and `alt` are byte-identical on all 18. Screenshots have identical dimensions;
Album and Member detail are pixel-identical, the others differ by a few hundred antialiased pixels where one text node
became several messages (under 0.2% of the page). The first phase measured the same on Overview, Events, Members and
Audit log. Spanish and pseudo screenshots of the migrated pages were reviewed by a design auditor; the rounds and
fixes are in `docs/sessions/SESSION_sandervonk_2026-11-18_985.md` and `docs/sessions/SESSION_sandervonk_2026-11-18_976.md`.

Phone cards: the `td[data-label]::before` label is now an in-flow float (`display: flow-root` on the cell), so a label
that wraps to three lines grows the row instead of overlapping the next one. English rendering is unchanged.

## Known limitations

- Audit summaries and callable error messages are translated from server keys (`summaryKey`/`summaryParams`,
  `details.messageKey`; area `errors` and `audit.summary.*`, see [backend-i18n.md](backend-i18n.md)). English shows the
  server text unchanged; entries and errors without a key, mock data and the CSV export stay English.
- `<head>` metadata and the static boot HTML are English.
- Interest names and theme names are catalog or company content and are not translated.
- No RTL, no Klingon.
