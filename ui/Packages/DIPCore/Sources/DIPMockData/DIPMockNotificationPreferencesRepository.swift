import DIPCore
import Foundation

/// In-memory preferences for previews, demo mode, UI tests and unit tests; never a Firebase adapter. Saves are kept so
/// a screen reopened in the same session sees them, which is what the persistence UI test relies on.
public actor DIPMockNotificationPreferencesRepository: DIPNotificationPreferencesRepository {
    public struct Behavior: Equatable, Sendable {
        public var loadFailure = false
        /// Fails the next this-many saves, then succeeds.
        public var failingSaves = 0
        public var latency: Duration = .zero
        public init(loadFailure: Bool = false, failingSaves: Int = 0, latency: Duration = .zero) {
            self.loadFailure = loadFailure; self.failingSaves = failingSaves; self.latency = latency
        }
    }

    public struct Failure: Error, Equatable, Sendable { public init() {} }

    private var stored: DIPNotificationPreferences
    private var behavior: Behavior
    public private(set) var saves: [DIPNotificationPreferences] = []
    /// The channel each entry of `saves` wrote, in the same order.
    public private(set) var savedChannels: [DIPNotificationChannel] = []

    public init(preferences: DIPNotificationPreferences = .defaults, behavior: Behavior = Behavior()) {
        self.stored = preferences; self.behavior = behavior
    }

    public func load() async throws -> DIPNotificationPreferences {
        if behavior.latency > .zero { try await Task.sleep(for: behavior.latency) }
        if behavior.loadFailure { throw Failure() }
        return stored
    }

    public func save(_ preferences: DIPNotificationPreferences, on channel: DIPNotificationChannel) async throws {
        if behavior.latency > .zero { try await Task.sleep(for: behavior.latency) }
        if behavior.failingSaves > 0 { behavior.failingSaves -= 1; throw Failure() }
        // Like the merge write: only this channel's switches change, the other channel keeps its stored state.
        var merged = stored
        for category in DIPNotificationCategory.offered(on: channel) {
            merged = merged.setting(category, on: channel, to: preferences.isEnabled(category, on: channel))
        }
        stored = merged
        saves.append(preferences)
        savedChannels.append(channel)
    }

    public func setBehavior(_ behavior: Behavior) { self.behavior = behavior }
}
