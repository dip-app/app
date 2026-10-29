# UI foundations preview host

This development-only app has no Firebase dependency. Its default destination is the native SwiftUI Home fixture, using matching Figma content and bundled resources. It is a visual implementation fixture, not a completed account, event, challenge or rewards workflow. The DIP app startup also presents this fixture until account/repository integration is implemented.

From the repository root, with Xcode, an installed iPhone simulator runtime and XcodeGen:

```sh
python3 ui/ComponentPreview/verify.py
```

Pass `--device UDID` to choose a specific simulator and `--derived-data /tmp/dip-preview-build` to reuse build output. The script's automatic choice is suitable for interaction checks; visual comparison must explicitly select a device matching Home's 402 × 874 point viewport. Open `ui/ComponentPreview/DIPFoundationPreview.xcodeproj`, scheme `Preview`, for manual review.

The host uses light appearance. Launch with `--gallery` to inspect the earlier interactive component gallery; `--large-text` requests Accessibility 3 text for applicable review. Gallery callbacks only update local messages and counters. Home interactions are presentation/navigation fixtures and do not mutate Firebase or imply that destination workflows are implemented.

The Home revision replaces the earlier gallery screenshot as the primary visual review target. Home geometry/action tests, original font registration checks and same-viewport image comparison have passed; measured raster differences and remaining manual reviews are recorded. Tests and screenshots must be described by the screen and states they actually exercise; gallery tests alone do not validate Home. See [review notes](Review/README.md) and [asset provenance](../../docs/design/asset-provenance.md).
