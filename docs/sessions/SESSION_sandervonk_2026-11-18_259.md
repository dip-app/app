# Work session

User: sandervonk
Date: 2026-11-18
Workstream: ios-i18n
Agent: Claude (Opus lead, Sonnet extraction and translation subagents)
Status: handoff

## Summary

iOS internationalization (#259), part 1 of 3: the Swift packages. DIPCore, DIPPresentation, DIPAccounts and
DIPDesignSystem gain String Catalogs (`defaultLocalization: "en"`, `bundle: .module` lookups). All user-facing package
copy is extracted, with semantic keys and translator comments, plural variations, an English source, a Spanish
translation and the Klingon demo locale. English output is unchanged. Part 2 covers the app target, part 3 the tooling
and docs.

## Changes

- `ui/Packages/*/Package.swift`: `defaultLocalization: "en"`.
- New catalogs:
  - `ui/Packages/DIPCore/Sources/DIPCore/Resources/Localizable.xcstrings`: 240 keys, 15 plural.
  - `DIPPresentation`: 21 keys.
  - `DIPAccounts`: 4 keys.
  - `DIPDesignSystem/Resources/Localizable.xcstrings`: 45 keys, 9 plural.
- DIPCore changes:
  - Errors, statuses, notification categories and levels, change log, calendar overlap text, photo saving, points,
    theme names, bug report categories and onboarding copy are localized.
  - `DIPChangeRow` gains a stable `key`, so logic no longer compares labels.
  - `DIPInviteStatusLabel` and `DIPNotificationRules.Group` get `localizedTitle`; raw values are unchanged.
  - `relativeTime` uses the injected or current locale instead of a hardcoded `en_US`.
- DIPDesignSystem changes:
  - `Text`, `Label` and accessibility literals use `bundle: .module`.
  - `DIPHomeTab.title` is new.
  - `DIPStateView` `retryTitle` defaults to a localized "Try again", and is source compatible.
- DIPMockData: the challenge fixture formats with the current locale (en_US output is identical).

## Validation

- `swift test` passes for DIPCore (337 XCTest plus Swift Testing), DIPDesignSystem (37) and DIPAccounts (25).
- Full app simulator build with these packages: passes.
- English screenshots match the origin/main baseline on Claude-Base (see the part 2 log).

## Decisions

- Each package has its own catalog and looks up with `bundle: .module`. Packages never rely on the app catalog.
- Points keep paired `.one`/`.other` keys, because the count is shown grouped ("1,234"), and a plural variation would
  force `%lld`.

## Handoff

Part 2 (app target, `SESSION_sandervonk_2026-11-18_260.md`) and part 3 (tooling and docs, `_261`) follow.
