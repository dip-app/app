import DIPDesignSystem
import Observation
import SwiftUI

/// The weekly-theme page's entry action, handed to the shell's shared bottom bar (the same pill as "Activity Chat" or
/// "Add Photos"). The page publishes the action and what pressing it does; the shell renders it in
/// `DIPFloatingNavigation` and calls `perform`. Cleared when the page goes away, so no other screen shows it.
@MainActor @Observable
final class ChallengeEntryBar {
    private(set) var action: DIPBottomBarAction?
    @ObservationIgnored private(set) var perform: (() -> Void)?
    @ObservationIgnored private var owner: String?

    func set(_ action: DIPBottomBarAction?, owner: String, perform: @escaping () -> Void) {
        self.owner = owner
        self.action = action
        self.perform = perform
    }

    /// Only the page that published the action may clear it (a newer page keeps its own).
    func clear(owner: String) {
        guard self.owner == owner else { return }
        action = nil; perform = nil; self.owner = nil
    }
}

extension EnvironmentValues {
    /// Nil outside the shell (standalone previews render their own bar).
    @Entry var challengeEntryBar: ChallengeEntryBar? = nil
}
