# iOS workspace

Install Xcode and XcodeGen (`brew install xcodegen`). From the repository root run `npm run ios:generate`, then open `ui/DIP.xcodeproj` and choose the DIP scheme. Commit `project.yml`, not generated project files. This avoids shared project-file conflicts. The target is iOS 17+, Swift 6; the minimum OS and final bundle identifier are proposed team decisions. Set your signing team locally in Xcode for device runs.

This is a bootstrap target, not a product UI. DIPAccounts and the compiled FirebaseAccountsRepository now provide account-session/repository behavior, but Firebase initialization, approved onboarding screens and live root composition remain unimplemented. Copy the correct environment's GoogleService-Info.plist locally when a project is selected; do not commit it or service account credentials. Add initialization and emulator selection together in the first integration PR. Emulator host is 127.0.0.1 on Simulator; physical devices need the laptop LAN address. Never connect a development build to production by default.

`DIPContracts` contains generated Foundation DTOs. `DIPDesignSystem` contains token foundations. These packages and DIPAccounts test independently of an iPhone simulator. JSON dates use ISO 8601 UTC; Firestore persistence uses Timestamp via explicit adapters in Data; the account adapter supplies the first mapping. Document IDs belong to snapshot metadata; optional `id` is injected by the adapter and is not a Firestore field.

Use feature ViewModels and injectable repository protocols. Views render state and delegate actions; Firebase access lives in Data. Define the protocol and mock fixture together before separate agents build UI and adapters. Do not invent endpoints or duplicate shared tokens.

Full simulator build after generation: `xcodebuild -project ui/DIP.xcodeproj -scheme DIP -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`. Full app tests: choose an available iPhone simulator using `xcodebuild -showdestinations`, then pass its destination to `xcodebuild test`. The feature test is explicitly skipped until work begins.

Read [V1 account integration](../docs/contracts/accounts-integration.md) before wiring AccountsSession. It explains configured SDK injection, token refresh after verification, listener disposal, profile limits and remaining device/App Check work. The full SDK app build is now required in CI; sources exclude Markdown documentation to avoid duplicate bundle-resource outputs.
