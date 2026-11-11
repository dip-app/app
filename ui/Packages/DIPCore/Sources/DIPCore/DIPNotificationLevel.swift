import Foundation

/// Per-event notification preference (`events/{e}/subscriptions/{uid}.level`).
public enum DIPNotificationLevel: String, CaseIterable, Equatable, Sendable {
    case all, changes, reminders, none

    public var title: String {
        switch self {
        case .all: "All"
        case .changes: "Changes"
        case .reminders: "Reminders"
        case .none: "None"
        }
    }

    public var summary: String {
        switch self {
        case .all: "Chat messages, event changes and reminders"
        case .changes: "Event changes and reminders"
        case .reminders: "Reminders only"
        case .none: "No notifications for this activity"
        }
    }
}

public extension DIPRepository {
    /// Adapters without preference support return nil (the menu stays hidden).
    func notificationLevel(eventID: String) async throws -> DIPNotificationLevel? { nil }
    func setNotificationLevel(eventID: String, level: DIPNotificationLevel) async throws {
        throw DIPRepositoryError.invalidInput("Notification settings aren’t available yet")
    }
}
