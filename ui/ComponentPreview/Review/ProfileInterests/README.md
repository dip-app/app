# Profile and account review

Fresh iPhone 17 Pro simulator captures from November 3, 2026 (402 × 874 points). The normal profile retains the source artwork; Add interests, the picker and accessibility layout are user-requested native compositions, not new Figma frames.

- [Profile](profile-refined.png)
- [Catalog](profile-interest-catalog.png)
- [Retained selection and visible retry](profile-interest-retry.png)
- [Search empty state](profile-interest-no-results.png)
- [Large-text profile](profile-large-text.png)
- [Large-text picker](profile-interest-large-text.png)
- [Observed account-backed profile](profile-account-backed.png)

Eight account/profile UI tests pass on the clean simulator: login and recovery, sign-out, search/save/reopen, save failure/retry, nested cancellation preserving metadata, and large text. Fixture launch: `--screen=profile`; account-backed launch: `--onboarding=welcome`. The former uses the synthetic catalog for design review; the latter uses the same account repository and catalog as the real composition, with an in-memory account adapter in this Firebase-free host.

The actual app uses FirebaseAccountsRepository when configured and PreviewAccountsRepository otherwise in Debug. Profile writes are UID-bound; stored tag IDs remain stable across display-name changes. Events/social features remain mock-backed. A further account-backed scenario verifies saved interests surviving sign-out/re-entry. Compact search-empty feedback remains visible while typing; explicit Dynamic Type propagation preserves sheet scaling. Physical-device and VoiceOver testing are not claimed.
