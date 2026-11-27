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

    /// The ONE reader of `--flag` launch arguments. Release builds never honor them (they would otherwise let anyone
    /// who can pass launch arguments switch on test fixtures, delays or failure injection in a shipped app).
    enum Flags {
        static func contains(_ flag: String, arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
            #if DEBUG
            return arguments.contains(flag)
            #else
            return false
            #endif
        }

        /// The value of a `--name=value` launch argument (pass `"--name="`); always nil in Release.
        static func value(of prefix: String, arguments: [String] = ProcessInfo.processInfo.arguments) -> String? {
            #if DEBUG
            return arguments.first { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)) }
            #else
            return nil
            #endif
        }
    }

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
        // The same review fixtures the Preview shell honors, so every designed state can be captured in the real app.
        let emptyState = arguments.first { $0.hasPrefix("--empty-state=") }
            .flatMap { DIPEmptyStateFixture(rawValue: String($0.dropFirst("--empty-state=".count))) }
        var snapshot = emptyState.map { DIPMockFixtures.emptyStateReview($0, base: DIPMockFixtures.v1Events()) } ?? DIPMockFixtures.v1Events()
        if arguments.contains("--event-cancelled") {
            snapshot.eventDetails["puppy-yoga"]?.metadata?.status = .cancelled
        } else if arguments.contains("--event-full"), let capacity = snapshot.eventDetails["puppy-yoga"]?.metadata?.capacity {
            snapshot.eventDetails["puppy-yoga"]?.attendeeCount = capacity
        }
        // `--screen=event` reviews Puppy Yoga before joining (the fixture seeds it as joined).
        if arguments.contains("--screen=event") || arguments.contains("--event-full") || arguments.contains("--event-cancelled") {
            snapshot.eventDetails["puppy-yoga"]?.isJoined = false
            snapshot.activeEvents.removeAll { $0.id == "puppy-yoga" }
        }
        if arguments.contains("--album-readonly") {
            for id in snapshot.albums.keys { snapshot.albums[id]?.canAddPhotos = false }
        }
        if let state = DIPCalendarModel.fakeState(arguments) { snapshot = DIPCalendarModel.alignedFixtures(snapshot, state: state) }
        // `--cover-library`: every event uses a hosted library cover (to review remote loading and the bundled fallback).
        if arguments.contains("--cover-library") {
            let cover = DIPEventCover.media(coverImageURL: "catalog://cover/theme-outdoors", tagIds: [])
            for index in snapshot.home.events.indices { snapshot.home.events[index].image = cover }
            for index in snapshot.activeEvents.indices { snapshot.activeEvents[index].image = cover }
            for id in snapshot.eventDetails.keys { snapshot.eventDetails[id]?.image = cover }
        }
        return snapshot
    }
    /// `--shell-state=loading` holds the first snapshot for an hour (page skeleton); `--shell-state=failed` fails the first
    /// observation once (full-page error with Try again). Review and UI tests only.
    static func shellLoadDelay(arguments: [String] = ProcessInfo.processInfo.arguments) -> Duration {
        arguments.contains("--shell-state=loading") ? .seconds(3600) : .zero
    }
    static func shellFailures(arguments: [String] = ProcessInfo.processInfo.arguments) -> [DIPMockOperation: String] {
        arguments.contains("--shell-state=failed") ? [.observation: "Check your connection and try again."] : [:]
    }
    #else
    static func shellLoadDelay() -> Duration { .zero }
    static func shellFailures() -> [DIPMockOperation: String] { [:] }
    static func mode(arguments: [String] = [], environment: [String: String] = [:]) -> Mode? { nil }
    static func snapshot() -> DIPAppSnapshot? { nil }
    #endif
}
