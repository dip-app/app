# Work session

User: sandervonk
Date: 2026-11-18
Workstream: ios-i18n
Agent: Claude (Opus lead, Sonnet extraction and translation subagents)
Status: handoff

## Summary

iOS internationalization (#259), part 2 of 3: the app target. All user-facing app copy is localized: views, view
models, alerts, errors, accessibility text, onboarding, the bug report, invites, notifications, profile, rewards,
album, chat and calendar copy. There is an app String Catalog (766 keys, 25 plural) and an `InfoPlist.xcstrings` for the
permission prompts. Spanish is complete and Klingon is a demo locale. There is also a hidden demo language override.
English is pixel-identical to origin/main apart from clock text.

## Changes

- `ui/project.yml`:
  - `developmentLanguage: en`
  - `LOCALIZATION_PREFERS_STRING_CATALOGS`, `SWIFT_EMIT_LOC_STRINGS` and `LOCALIZED_STRING_SWIFTUI_SUPPORT`
  - `CFBundleDevelopmentRegion: en` and `CFBundleLocalizations: [en, es, tlh]`
  - Disabled scheme run arguments for es, tlh, double-length and missing-string logging
- New catalogs: `ui/DIP/Resources/Localizable.xcstrings` and `ui/DIP/Resources/InfoPlist.xcstrings`.
- About 500 strings converted across 55 files in `ui/DIP`. Count ternaries became catalog plurals.
- Logic no longer depends on display text:
  - The change sheet picks icons by `DIPChangeRow.key`.
  - The album save haptic uses `AlbumPhotoSaver.lastRunSucceeded`.
  - Tab titles use `DIPHomeTab.title`.
- Home section headings stay on one line and shrink slightly for long translations. The challenge heading stays clear of
  the mascot. English rendering is unchanged.
- `ui/DIP/Features/Profile/DemoLanguageOverride.swift`: hidden menu, opened by a 2 s long press on "Favorite Memories".
  It offers System, English, Español and tlhIngan Hol, writes the per-app `AppleLanguages` and asks for a relaunch.

## Validation

- Builds: `xcodebuild` Debug simulator (arm64), full app, passes.
- Targeted tests on Claude-Base (iPhone 17 Pro), 34 in all, all pass:
  - `DIPTests/AlbumPhotoSaverTests`, `MemberProfileBridgeTests` and `MemberAlbumTests`: 28 tests.
  - `DIPUITests/MockMemberLaunchUITests` and `NotificationSettingsUITests`: 6 tests.
- English pixel comparison against an origin/main build on Claude-Base, 12 screens with `--mock-member --screen=`:
  - Identical: album, attendees, challenge, event, invitations, notification-settings, past-event, profile and rewards.
  - Home and events: only the fixture event time differs, because fixtures are relative to launch time.
  - Notifications: only time text differs. The simulator forces 24-hour time, and the notification time now follows it
    instead of a hardcoded en_US.
- Duo (Claude-Duo), Profile in English: 88 px differ, inside the empty-state avatar art. No text differs.
- Spanish on Claude-Base: home, event, profile, rewards, notifications, challenge and invitations are clean. Fixes:
  "Vas a ir" for the Invitations "Going" header, and "Marcar como leídas".
- Double-length pseudolanguage on Claude-Base: layouts wrap or truncate cleanly. Fixed the Home challenge heading
  running under the mascot.
- Klingon via the demo override and a relaunch: home and event are clean.
- Design auditor subagent: PASS. English is unchanged, and the Spanish and pseudolanguage layouts are clean.
- Screenshots: scratchpad `i18n/shots/{base,en,en2,es,pseudo,tlh,duo-base,duo-en}`. They are review evidence and not
  committed.

## Decisions

- Keys: SwiftUI literals keep English-as-key. Every `String` uses a semantic dot key with an English default and a
  comment.
- Server and fixture content stays untranslated: event titles, notification bodies and challenge descriptions.

## Handoff

Part 3 (`_261`): guardrail script, sync script, docs.
