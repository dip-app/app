# Work session

User: sandervonk
Date: 2026-11-18
Workstream: ios-i18n
Agent: Claude (Opus lead)
Status: completed

## Summary

Second follow-up to the iOS i18n PRs. After #312 the packages build on CI, but four DIPCore tests failed there. The
singular English forms ("1 photo", "1 event", "1 other participating") came out as the plural fallback.

The CI command-line SwiftPM does not compile `Localizable.xcstrings`; the log shows "Copying Localizable.xcstrings".
That holds for both the runner default Xcode 16.4 and Xcode 26.3, which I checked with a workflow_dispatch run on a
branch. Lookups then fall back to the English default, which was the "other" form. Xcode app builds and local Xcode 27
`swift test` compile the catalogs.

## Changes

- English defaults no longer depend on the compiled catalog. For each package plural whose English singular differs,
  `defaultValue` picks the English singular or plural by count. The catalog plural variations still drive the
  translations.
- Covered sites:
  - DIPCore: `challenge.participation.others` and `.spoken.others`, `album.save.*` (5 keys) and
    `home.filter.announce.all`.
  - DIPDesignSystem: `ds.avatarGroup.count` and `.countWithNames`.
- The workflow is unchanged. Moving package tests to Xcode 26 did not help, so that branch was dropped.

## Validation

- `swift test` for DIPCore (337 plus Swift Testing) and DIPDesignSystem (37) passes with the real catalogs.
- Both suites also pass with both package catalogs emptied. That simulates the CI toolchain, which leaves catalogs
  uncompiled.
- Swift checks were dispatched on the branch before merging; the result is in the PR.

## Decisions

English must render correctly even when a catalog is not compiled. A package plural keeps the English one/other choice in
code, and the catalog owns every other language.

## Handoff

None if Swift checks on main are green.
