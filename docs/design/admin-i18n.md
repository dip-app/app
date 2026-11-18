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
`challenges`, `ai`. 1,214 keys in total (337 of them `ai.*`).

## Writing copy

```ts
import { formatDate, formatNumber, t } from "@/lib/i18n";

t("events.title");
t("members.count.people", { count: total, shown: formatNumber(shown) });
// en: "{count, plural, one {# person} other {# people}}"
```

- **Never call `t()` at module scope.** A module constant keeps the language it was built in. Store keys
  (`{ id: "upcoming", labelKey: "events.filter.upcoming" }`) and translate at render, use a function, or use getters
  (`ROLE_LABEL`, `AUDIT_LABELS` and `STEPS` are getter-backed so existing callers keep working). The guardrail flags
  `t()` outside a function.
- **One message per sentence.** Use slots for values and plural messages for counts instead of English ternaries. `#`
  is formatted with the locale (en-US output stays "1,234"); a plain `{slot}` inserts `String(value)`, so format
  numbers with `formatNumber` first when they were grouped before.
- **Dates and numbers** go through `formatDate`, `formatTime`, `formatNumber`, `dateTimeFormat` or `intlLocale()`.
  English maps to `en-US`, so output is unchanged; Spanish uses `es-419`. Currency stays USD and uses the narrow
  symbol (`$15.00` in both languages).
- **Not translated:** event titles and descriptions, names, emails, team and theme names, interest names from the tag
  catalog, audit summaries and reasons written by the backend, ApiError messages from the backend (and the mock that
  stands in for it), CSV file names, "DIP", "DIP Admin" (`BRAND`) and "Dipbot" (`{ai}`). `<head>` metadata (title,
  description, Open Graph) is static and stays English.
- US English, no em dashes, no provider names in new copy. Compare ids in logic, never display text.
- Mark a migrated file with a `// @i18n-migrated` comment. The guardrail then scans it for hard-coded strings.

To add an area, create `en/<area>.ts` and `es/<area>.ts` and spread both into the two `index.ts` files.

## Language selection

There is no profile field yet (a member locale on the server is the backend phase of #259). The portal picks:

1. The choice in Your settings > Language, stored in this browser (`localStorage["dip.admin.locale"]`).
2. Otherwise the first browser language the portal ships (`es-MX` and `es` pick Spanish), else English.

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

Shared chrome (Shell and navigation, boot and error pages, kit components, dialogs, tabs, toasts, skeletons, load
states, AdminOnly), sign-in, Overview, Events list and the event editor (form, preview, When, Where, venues, covers),
Members list, Weekly themes and Challenges lists, Audit log (labels, categories, facts), the Dipbot wizard and Ideas
for you, the weekly ideas email settings, and Your settings with the new Language section. 89 files carry the marker.

**Follow-up (not migrated yet): 634 likely UI strings in 12 files** per `--remaining`: import page (112) and
ImportMapping (34), roster (88), bug reports (84), challenge review (83), member detail (72), event attendees (63),
event album (35), ThemeForm (42), ThemePreview (11), theme edit/new pages (10). The other 195 findings are the mock
backend and API adapters (server content until the backend phase).

## Evidence that English did not change

Mock mode, Chrome headless with reduced motion, full-page screenshots of the base commit and this branch at 1440 and
390 px for Overview, Events, Members and Audit log (plus Challenges and Weekly themes at 390): the visible text and
every `aria-label`, `title` and `placeholder` are identical on all pages, and the images are pixel-identical except 26
antialiased pixels on Overview at 1440 and 2 at 390 (the week progress label is now one text node instead of
several), plus 51 on Weekly themes at 390 from the same cause. Spanish and pseudo screenshots of the same pages and Your
settings were reviewed by a design auditor; the phone-card label column and a few Spanish terms were fixed, and the
review passed. Details are in `docs/sessions/SESSION_sandervonk_2026-11-18_976.md`.

## Known limitations

- Backend content stays English in every language: audit summaries ("Invited Nico Farrow"), ApiError messages, mock
  data. Building these from action keys and parameters is part of the backend phase.
- `<head>` metadata and the static boot HTML are English.
- Interest names and theme names are catalog or company content and are not translated.
- No RTL, no Klingon, no per-member server locale yet.
