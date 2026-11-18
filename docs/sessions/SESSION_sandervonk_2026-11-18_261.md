# Work session

User: sandervonk
Date: 2026-11-18
Workstream: ios-i18n
Agent: Claude (Opus lead, Sonnet extraction and translation subagents)
Status: completed

## Summary

iOS internationalization (#259), part 3 of 3: guardrails, tooling and docs. `npm run check:ios-i18n`, which is part of
`npm run check`, validates the String Catalogs and flags likely unlocalized UI strings. `npm run ios:i18n-sync` updates
catalogs from a command-line build. `docs/design/ios-i18n.md` documents conventions, plurals, formatting, languages,
the demo override and testing.

## Changes

- `scripts/ios-i18n-check.py` (pure Python) fails on:
  - missing or `new` Spanish entries and missing plural forms;
  - stale keys;
  - semantic keys used in Swift but missing from the catalog, or present but unused;
  - format-specifier mismatches in any language, including tlh;
  - package lookups without `bundle: .module`;
  - English literals passed to plain-String UI parameters.

  `scripts/ios-i18n-allowlist.txt` holds the 19 reviewed exceptions: the dev gallery, brand names, an unused parameter
  and glyphs.
- `scripts/ios-i18n-sync.py`: wraps `xcstringstool sync` over the build's `.stringsdata` files.
- `scripts/tests/test_ios_i18n_check.py`: 12 tests.
- `package.json`: `check:ios-i18n` and `ios:i18n-sync`; `check` runs the guardrail.
- `docs/design/ios-i18n.md` (new) and the `docs/milestones/v2/STRETCH_GOALS.md` #259 status.

## Validation

- `python3 scripts/ios-i18n-check.py`: OK (1079 keys in 6 catalogs).
- `python3 -m unittest scripts/tests/test_ios_i18n_check.py`: 12 passed.
- `python3 scripts/check-docs.py`: OK.

## Decisions

- Spanish is the shipped language and must be complete. Klingon is a demo locale: only its specifiers are checked, and
  missing strings fall back to English.
- Right-to-left layout is out of scope for now, by owner direction. Duo was checked only for English regressions.
- Member language for email and push is a later backend phase. Nothing is stored on the profile.

## Handoff

Remaining for #259:
- a native-speaker review of Spanish (state `translated`);
- a Klingon canon review if it matters (state `needs_review`);
- admin portal i18n (other agents);
- email and push copy with a member locale;
- other languages;
- translating server-provided content.
