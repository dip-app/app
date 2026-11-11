import DIPAccounts
import DIPCore
import DIPMockData
import Foundation

/// Debug-only mock launch mode so UI tests and captures can drive the real app shell
/// (navigation, tab bar, icon) without Google sign-in or live Firebase.
///
/// `--mock-member` (or `DIP_MOCK_MEMBER=1`): skip Firebase/App Check configuration and boot
/// into the signed-in member experience for a fixed fixture member backed by in-memory
/// repositories. `--mock-onboarding`: same isolation, but start signed out so the
/// first-run welcome and onboarding flow can be exercised for a fresh uid.
///
/// Release builds compile this to a stub that never activates. Nothing here touches the
/// keychain, Firebase, the network or secrets.
enum MockLaunch {
    enum Mode: Equatable { case member, onboarding }

    #if DEBUG
    static func mode(
        arguments: [String] = ProcessInfo.processInfo.arguments,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Mode? {
        if arguments.contains("--mock-onboarding") { return .onboarding }
        if arguments.contains("--mock-member") || environment["DIP_MOCK_MEMBER"] == "1" { return .member }
        return nil
    }

    @MainActor static func makeRepository(_ mode: Mode) -> any AccountsRepository & InterestCatalogRepository {
        switch mode {
        case .member: PreviewAccountsRepository(signedInEmail: "member@example.invalid", delay: .zero)
        case .onboarding: PreviewAccountsRepository(googleAccount: "new@example.invalid", delay: .milliseconds(300))
        }
    }

    /// Reference prototype content with dated events that carry venue, address and cost.
    /// Album review (with `--screen=album`): `--empty-state=album` empties the Kayaking album and
    /// `--album-readonly` shows it to a member who may not add photos.
    static func snapshot(arguments: [String] = ProcessInfo.processInfo.arguments) -> DIPAppSnapshot? {
        guard mode() != nil else { return nil }
        var snapshot = arguments.contains("--empty-state=album") ? DIPMockFixtures.emptyStateReview(.album) : DIPMockFixtures.v1Events()
        if arguments.contains("--album-readonly") {
            for id in snapshot.albums.keys { snapshot.albums[id]?.canAddPhotos = false }
        }
        return snapshot
    }
    #else
    static func mode(arguments: [String] = [], environment: [String: String] = [:]) -> Mode? { nil }
    static func snapshot() -> DIPAppSnapshot? { nil }
    #endif
}
