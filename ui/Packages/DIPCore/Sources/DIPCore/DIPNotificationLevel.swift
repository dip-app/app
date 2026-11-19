import Foundation

/// Per-event notification preference (`events/{e}/subscriptions/{uid}.level`).
public enum DIPNotificationLevel: String, CaseIterable, Equatable, Sendable {
    case all, changes, reminders, none

    public var title: String {
        switch self {
        case .all: String(localized: "notif.level.all.title", defaultValue: "All", bundle: .module, comment: "Per-activity notification level title")
        case .changes: String(localized: "notif.level.changes.title", defaultValue: "Changes", bundle: .module, comment: "Per-activity notification level title")
        case .reminders: String(localized: "notif.level.reminders.title", defaultValue: "Reminders", bundle: .module, comment: "Per-activity notification level title")
        case .none: String(localized: "notif.level.none.title", defaultValue: "None", bundle: .module, comment: "Per-activity notification level title: no notifications")
        }
    }

    public var summary: String {
        switch self {
        case .all: String(localized: "notif.level.all.summary", defaultValue: "Chat messages, event changes and reminders", bundle: .module, comment: "Per-activity notification level description")
        case .changes: String(localized: "notif.level.changes.summary", defaultValue: "Event changes and reminders", bundle: .module, comment: "Per-activity notification level description")
        case .reminders: String(localized: "notif.level.reminders.summary", defaultValue: "Reminders only", bundle: .module, comment: "Per-activity notification level description")
        case .none: String(localized: "notif.level.none.summary", defaultValue: "No notifications for this activity", bundle: .module, comment: "Per-activity notification level description")
        }
    }
}

public extension DIPRepository {
    /// Adapters without preference support return nil (the menu stays hidden).
    func notificationLevel(eventID: String) async throws -> DIPNotificationLevel? { nil }
    func setNotificationLevel(eventID: String, level: DIPNotificationLevel) async throws {
        throw DIPRepositoryError.rejected(DIPMemberMessage(localized: String(localized: "notif.level.unavailable", defaultValue: "Notification settings aren’t available yet", bundle: .module, comment: "Error when the repository has no per-activity notification settings")))
    }
}
