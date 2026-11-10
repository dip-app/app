import DIPCore
import Foundation
import Observation
import SwiftUI

/// Home "This Week's Challenge" state for one membership lease.
///
/// - First load shows `.loading`; later refreshes keep the rendered card (no flashing skeleton).
/// - A failed refresh keeps the last card and marks it stale; with nothing to show it is `.failed`.
/// - Sign-out, account or company change (`.unauthenticated`) or `stop()` clears every value so
///   another tenant never sees this one's theme. The host re-creates the feed per membership.
@MainActor @Observable final class WeeklyChallengeFeed {
    private(set) var state: DIPChallengeCardState = .loading
    private(set) var current: DIPWeeklyChallenge?
    private(set) var isRefreshing = false
    private var repository: MemberChallengesRepository?
    private let clock: () -> Date
    private var generation = UUID()
    private(set) var stopped = false

    init(repository: MemberChallengesRepository? = nil, clock: @escaping () -> Date = Date.init) {
        self.repository = repository; self.clock = clock
    }

    /// Installs the lease once (the host creates the SDK-backed repository lazily in `.task`).
    func attach(_ repository: MemberChallengesRepository?) {
        guard !stopped, self.repository == nil else { return }
        guard let repository else { state = .failed(DIPChallengeText.failure); return }
        self.repository = repository
    }

    /// First load, in-place retry, pull-to-refresh and foreground refresh all use this.
    func load() async {
        guard !stopped, let repository else { return }
        let token = UUID(); generation = token
        isRefreshing = true
        if current == nil, case .failed = state { state = .loading }
        defer { if generation == token { isRefreshing = false } }
        do {
            let result = try await repository.current(now: clock())
            guard generation == token, !stopped else { return }
            current = result.challenge
            state = result.challenge.map { .current(DIPChallengeProjection.summary($0), stale: result.stale) } ?? .none
        } catch {
            guard generation == token, !stopped else { return }
            if error as? ChallengeReadFailure == .unauthenticated { stop(); return }
            // Offline or a transient failure: keep the last card unless its week is over.
            if let current, current.isCurrent(at: clock()) {
                state = .current(DIPChallengeProjection.summary(current), stale: true)
            } else {
                current = nil
                state = .failed(DIPChallengeText.failure)
            }
        }
    }

    func detail(_ id: String) -> DIPChallengeDetail? {
        guard let current, current.id == id else { return nil }
        return DIPChallengeProjection.detail(current)
    }

    func stop() {
        guard !stopped else { return }
        stopped = true; generation = UUID(); isRefreshing = false
        repository?.invalidate(); repository = nil
        current = nil; state = .none
    }
}

/// Live challenge data for the member Home. Nil (the default) means the host uses the
/// repository snapshot's fixture challenge, as previews and unconfigured builds do.
extension EnvironmentValues {
    @Entry var weeklyChallengeFeed: WeeklyChallengeFeed? = nil
}

/// Owns one WeeklyChallengeFeed per membership and injects it below. The SDK-backed repository
/// is created in `.task`, never in `init`, so re-rendering cannot open extra listeners.
struct WeeklyChallengeHost<Content: View>: View {
    let makeRepository: () -> MemberChallengesRepository?
    @ViewBuilder let content: () -> Content
    @State private var feed = WeeklyChallengeFeed()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        content()
            .environment(\.weeklyChallengeFeed, feed)
            .task {
                feed.attach(makeRepository())
                await feed.load()
            }
            // A new week can begin while the app is in the background.
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await feed.load() } }
            }
            .onDisappear { feed.stop() }
    }
}
