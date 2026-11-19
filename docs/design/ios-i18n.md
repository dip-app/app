# iOS internationalization

The iPhone app is internationalized with String Catalogs (issue [#259](https://github.com/dip-app/app/issues/259), iOS
phase). English (US) is the source language. Spanish (`es`) is the first shipped translation. Klingon (`tlh`) is a demo
locale. The app follows the iOS language; there is no in-app setting for members.

## Catalogs and bundles

| Catalog | Module | Lookups |
| --- | --- | --- |
| `ui/DIP/Resources/Localizable.xcstrings` | app target | main bundle (default) |
| `ui/DIP/Resources/InfoPlist.xcstrings` | app `Info.plist` (permission prompts) | system |
| `ui/Packages/DIPCore/Sources/DIPCore/Resources/Localizable.xcstrings` | DIPCore | `bundle: .module` |
| `ui/Packages/DIPCore/Sources/DIPPresentation/Resources/Localizable.xcstrings` | DIPPresentation | `bundle: .module` |
| `ui/Packages/DIPAccounts/Sources/DIPAccounts/Resources/Localizable.xcstrings` | DIPAccounts | `bundle: .module` |
| `ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources/Localizable.xcstrings` | DIPDesignSystem | `bundle: .module` |
| `ui/Packages/DIPCore/Sources/DIPMockData/Resources/Localizable.xcstrings` | DIPMockData (refusal messages of `DIPMockRepository.swift` only) | `bundle: .module` |

Each package declares `defaultLocalization: "en"`. SwiftPM compiles its catalog into the package resource bundle, both in
Xcode builds and in `swift test`. DIPContracts (generated DTOs) has no user-facing copy and no catalog. DIPMockData
fixture content (names, titles, chat, notices) stays verbatim like server content; only the mock repository's refusal
messages are localized (mock builds only), and the guardrail scans only that file for the DIPMockData catalog.

Refusals reach screens as `DIPRepositoryError.rejected(DIPMemberMessage)`. Build the message only from a
`String(localized:)` lookup or a failure type's localized `message`, never from server or SDK text.

`ui/project.yml` sets `developmentLanguage: en`, `LOCALIZATION_PREFERS_STRING_CATALOGS`, `SWIFT_EMIT_LOC_STRINGS`
(compiler-based extraction), `LOCALIZED_STRING_SWIFTUI_SUPPORT`, `CFBundleDevelopmentRegion: en` and
`CFBundleLocalizations: [en, es, tlh]`. iOS Settings > DIP > Language lists the system-supported entries (English,
Spanish). XcodeGen keeps all of this when you regenerate. Its `knownRegions` lists only Base and en, which does not
matter: the catalog compiler emits an `.lproj` for every language in the catalog.

## Adding or changing a string

- **SwiftUI literals in the app target.** `Text("Join")`, `Button("Save")`, `.accessibilityLabel("Send")`,
  `.navigationTitle(...)` and `TextField` prompts are localized automatically, with the English text as the key. Add
  `comment:` when a short word is ambiguous.
- **Any user-facing `String`.** This covers model and enum display names, view-model text, errors, strings passed to
  design-system components and alerts. Use a semantic key, an English default and a comment for translators:

  ```swift
  String(localized: "invites.error.full", defaultValue: "This activity is full.", comment: "Invite error: no spots left")
  ```

  Keys are lowercase, dot separated and prefixed by area (`event.`, `album.`, `profile.`, `ds.` for the design system).
- **In Swift packages, always pass `bundle: .module`.** This applies to `String(localized:..., bundle: .module)` and to
  `Text("...", bundle: .module)`. A bare `.accessibilityLabel("...")` in a package looks in the app bundle, so use
  `.accessibilityLabel(Text("...", bundle: .module))`. Copy constants are computed (`static var`), so they read the
  current language.
- **Interpolation.** Write one key per full sentence with arguments: `"\(name) invited you"` becomes `%@ invited you`.
  Never concatenate translated fragments. Translations reorder arguments with positional specifiers (`%2$lld … %1$@`).
- **Logic never depends on display text.** Compare stable ids, for example `DIPChangeRow.key`. Persisted enum raw values
  stay English; display goes through `localizedTitle`/`title`.
- **Not translated:** user and server content (event titles, descriptions, names, chat, notification titles and bodies
  written by the backend, interest names from the catalog), DIPMockData fixtures, `#if DEBUG` tooling, logs and
  accessibility identifiers. "DIP" and "Dipbot" are never translated.
- **Copy rules:** US English source and no em dashes.

After code changes, build once (Xcode or `xcodebuild`), then sync the catalogs. Xcode's IDE syncs as you build;
command-line builds only emit `.stringsdata` files:

```sh
npm run ios:i18n-sync -- --derived-data <DerivedData of that build>   # adds new keys, marks removed ones stale
```

Then translate the new keys (Xcode catalog editor, or edit the JSON) and run `npm run check:ios-i18n`.

## Plurals

Every count-dependent string is one key whose English default is the "other" form, for example
`String(localized: "album.save.done", defaultValue: "Saved \(n) photos to Photos", ...)`. The catalog carries the plural
variations: English `one` and `other`, Spanish `one` and `other`. Spanish has a CLDR `many` category for very large round
numbers; it falls back to `other`. Strings with several arguments vary by one argument through a substitution
(`%#@count@` with `argNum`), with the whole sentence in each form. English sometimes has the same text for both forms
(`%lld going`) while Spanish differs (`1 va`, `%lld van`). Package plurals whose English singular differs choose the English form by count in `defaultValue` as well
(`defaultValue: n == 1 ? "\(n) photo" : "\(n) photos"`). Command-line SwiftPM up to Xcode 26 copies `.xcstrings`
without compiling them, so `swift test` on CI only sees defaults. Points use paired `.one`/`.other` keys in `DIPPointsFormat`
because the number is shown grouped ("1,234"). Klingon has no number agreement, so it only fills `other`.

The conversion replaced 49 English count ternaries and count-bearing strings with catalog plurals: 25 in the app,
15 in DIPCore and 9 in DIPDesignSystem.

## Formatting

Dates, times and numbers go through locale-aware APIs with `Locale.current` or an injected locale defaulting to it:
`Date.FormatStyle`, `formatted(...)`, `setLocalizedDateFormatFromTemplate`, `NumberFormatter` and the relative-date
style. 12- or 24-hour time, month and day order and digit grouping therefore follow the device.

The one previously hardcoded `en_US` display formatter (notification times) now uses the current locale as well. On a
device with "24-Hour Time" on, it reads "09:59" instead of "9:59 AM", like the rest of the app. Currency stays USD.
Profile radius stays in miles; unit conversion is out of scope.

## Languages

- **es (shipped).** This is a complete, draft-quality translation in neutral Latin American Spanish with informal "tú".
  The catalog state is `translated`. **It needs review by a native speaker before release.** Glossary decisions:

  | English | Spanish |
  | --- | --- |
  | activity | actividad |
  | event | evento |
  | coworker | colega (gender neutral) |
  | Join | Unirme |
  | going | va / van |
  | points | puntos |
  | Rewards | Recompensas |
  | challenge | reto |
  | weekly theme | tema semanal |
  | entry | participación |
  | Memories | Recuerdos |
  | Album | Álbum |
  | Add Photos | Agregar fotos |
  | Settings | Ajustes |

  "Fitness" is kept as is.
- **tlh (demo, novelty).** This is Klingon in Okrand's Latin transliteration (tlhIngan Hol, not pIqaD). It covers the
  full UI in a playful but grammatical style, and every entry is `needs_review`. Glossary: wanI' (event), Qu' (activity),
  Quv (points, "honor"), pop (reward), qaD (challenge), jup (coworker), yImuv (join) and juH (home).

  It is not a shipped market language. Missing strings fall back to English, and the guardrail checks only its format
  specifiers. iOS Settings does not list it, so open it through the demo override or `-AppleLanguages (tlh)`. Klingon
  has no CLDR date data, so dates stay in English.

### Adding a language

1. Add the code to `CFBundleLocalizations` in `ui/project.yml`, then run `npm run ios:generate`.
2. Translate every catalog. You can use Xcode's catalog editor, or export with
   `xcodebuild -exportLocalizations -project ui/DIP.xcodeproj -localizationPath <dir> -exportLanguage <code>` and
   import with `-importLocalizations`. Fill each plural form the language's CLDR rules need.
3. If it ships, add it to `SHIPPED` in `scripts/ios-i18n-check.py`. A demo language goes in `DEMO`.
4. Check layouts in that language on Claude-Base (see Testing). Add it to `DemoLanguage` if it should appear in the
   demo menu.

## Language selection

DIP follows the iOS language and stores nothing on the member profile. A member can pick a different language for DIP in
iOS Settings > DIP > Language.

For demos there is a hidden override: on Profile, long-press the "Favorite Memories" heading for 2 seconds. The menu
offers System, English, Español and tlhIngan Hol, writes the per-app `AppleLanguages` preference and asks you to relaunch
DIP. It adds no visible UI.

Emails and push notifications follow the member's server-owned `users/{uid}.locale` (backend phase of #259, see
[backend-i18n.md](backend-i18n.md)). Since 0.1.2 the app keeps it in step: on sign-in and on foreground it maps its
preferred localization to `en` or `es` (Klingon and anything else to `en`) and calls `setMyLocaleV1` only when that
differs from the stored value, at most once per member and language in a launch, silently (`MemberLocaleSync`).

## Testing

- **Launch arguments.** Pass these to the app, or tick them in Edit Scheme > Run > Arguments; the DIP scheme lists them
  off by default.

  | Argument | Effect |
  | --- | --- |
  | `-AppleLanguages (es)` | Spanish |
  | `-AppleLanguages (tlh)` | Klingon |
  | `-NSDoubleLocalizedStrings YES` | Double-length pseudolanguage: every looked-up string is repeated |
  | `-NSShowNonLocalizedStrings YES` | Logs keys missing from a catalog |

  Simulator example:
  `xcrun simctl launch <udid> work.letsdip.app --mock-member --screen=home -AppleLanguages "(es)" -AppleLocale es_US`.
  Double-length mode garbles plural and positional format strings (`#@value@`); that is an Apple artifact, not an app
  bug. Use it to find truncation and overlap.
- **Guardrails.** `npm run check:ios-i18n` (part of `npm run check`) fails on:
  - missing or `new`-state Spanish entries, including missing plural forms;
  - stale catalog keys;
  - semantic keys used in Swift but missing from a catalog, or present in a catalog but unused;
  - format-specifier mismatches in any language;
  - likely unlocalized UI strings: package lookups without `bundle: .module`, and capitalized English literals passed
    to `title:`, `message:` and similar parameters.

  Reviewed exceptions are in `scripts/ios-i18n-allowlist.txt`. Regenerate it with `--update-allowlist` after review.
  Unit tests are in `scripts/tests/test_ios_i18n_check.py`.
- **English must not change.** The i18n work kept English pixel-identical. The evidence is in the session log for
  November 18.

## Out of scope for now

- **Right-to-left layout.** No RTL language is planned. Views use leading and trailing where they were touched, but
  there was no RTL audit or pseudolanguage pass.
- Duo layouts were only checked for English regressions.
- Other languages.
- Email and push copy are covered in [backend-i18n.md](backend-i18n.md), the admin portal in [admin-i18n.md](admin-i18n.md).
- Translating server or catalog content, such as interest names and theme descriptions.
