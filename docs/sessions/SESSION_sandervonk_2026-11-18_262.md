# Work session

User: sandervonk
Date: 2026-11-18
Workstream: ios-i18n
Agent: Claude (Opus lead)
Status: completed

## Summary

Follow-up to the iOS i18n PRs (#309, #310, #311). The Swift checks on main failed on the CI runner (macos-15-intel)
with "type 'Bundle?' has no member 'module'" in DIPAccounts. The local toolchain (Xcode 27) picks up a target's
`Localizable.xcstrings` automatically, but the runner's SwiftPM only synthesizes `Bundle.module` for declared resources.

## Changes

- `ui/Packages/DIPAccounts/Package.swift`, `ui/Packages/DIPCore/Package.swift`: the DIPAccounts, DIPCore and
  DIPPresentation targets declare `resources: [.process("Resources")]`, like DIPDesignSystem already did.

## Validation

- `swift test --package-path ui/Packages/DIPAccounts`: 25 passed.
- `swift test --package-path ui/Packages/DIPCore`: 337 XCTest plus Swift Testing suites, all passed.

## Decisions

Every package target with a String Catalog declares its Resources folder explicitly. Do not rely on toolchain
auto-detection.

## Handoff

Confirm the next "Swift checks" run on main is green.
