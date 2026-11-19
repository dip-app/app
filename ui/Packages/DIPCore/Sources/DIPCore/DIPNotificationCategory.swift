import Foundation

/// Delivery channel for account-level notification preferences.
public enum DIPNotificationChannel: String, CaseIterable, Sendable, Codable {
    case push, email
}

/// Account-level notification category. Raw values and case order mirror the server registry
/// (`gcp/functions/src/modules/notifications/domain/categories.ts`) verbatim.
public enum DIPNotificationCategory: String, CaseIterable, Equatable, Sendable, Codable {
    case invites
    case eventUpdates = "event_updates"
    case reminders, chat, challenges, social, discovery
    /// Email only: calendar invite emails (`.ics` that add the activity to the member's calendar).
    case calendarInvites = "calendar_invites"

    public var title: String {
        switch self {
        case .invites: String(localized: "notif.category.invites.title", defaultValue: "Invites", bundle: .module, comment: "Notification preference category title")
        case .eventUpdates: String(localized: "notif.category.eventUpdates.title", defaultValue: "Activity updates", bundle: .module, comment: "Notification preference category title")
        case .reminders: String(localized: "notif.category.reminders.title", defaultValue: "Reminders", bundle: .module, comment: "Notification preference category title")
        case .chat: String(localized: "notif.category.chat.title", defaultValue: "Chat", bundle: .module, comment: "Notification preference category title")
        case .challenges: String(localized: "notif.category.challenges.title", defaultValue: "Challenges", bundle: .module, comment: "Notification preference category title")
        case .social: String(localized: "notif.category.social.title", defaultValue: "Comments and photos", bundle: .module, comment: "Notification preference category title")
        case .discovery: String(localized: "notif.category.discovery.title", defaultValue: "Suggestions", bundle: .module, comment: "Notification preference category title")
        case .calendarInvites: String(localized: "notif.category.calendarInvites.title", defaultValue: "Calendar invites", bundle: .module, comment: "Notification preference category title (email only)")
        }
    }

    public var summary: String {
        switch self {
        case .invites: String(localized: "notif.category.invites.summary", defaultValue: "When a coworker invites you to an activity", bundle: .module, comment: "Notification preference category description")
        case .eventUpdates: String(localized: "notif.category.eventUpdates.summary", defaultValue: "Time or place changes, cancellations, and when an organizer adds you", bundle: .module, comment: "Notification preference category description")
        case .reminders: String(localized: "notif.category.reminders.summary", defaultValue: "About a day and an hour before activities you joined", bundle: .module, comment: "Notification preference category description")
        case .chat: String(localized: "notif.category.chat.summary", defaultValue: "New messages in activity chats", bundle: .module, comment: "Notification preference category description")
        case .challenges: String(localized: "notif.category.challenges.summary", defaultValue: "Submission reviews and new weekly themes", bundle: .module, comment: "Notification preference category description")
        case .social: String(localized: "notif.category.social.summary", defaultValue: "Comments on your photos and new photos from activities you went to", bundle: .module, comment: "Notification preference category description: comments on the member's album photos and new photos in albums of activities they attended")
        case .discovery: String(localized: "notif.category.discovery.summary", defaultValue: "New activities that match your interests", bundle: .module, comment: "Notification preference category description")
        case .calendarInvites: String(localized: "notif.category.calendarInvites.summary", defaultValue: "An email that adds activities you join to your calendar, and keeps it up to date", bundle: .module, comment: "Notification preference category description (email only)")
        }
    }

    /// Also subject to the per-activity level (`DIPNotificationLevel`).
    public var isGatedByActivityLevel: Bool {
        switch self {
        case .eventUpdates, .reminders, .chat: true
        default: false
        }
    }

    /// Categories a channel offers, in registry order. Chat and social are never emailed.
    public static func offered(on channel: DIPNotificationChannel) -> [DIPNotificationCategory] {
        switch channel {
        case .push: allCases.filter { $0 != .calendarInvites }
        case .email: [.invites, .eventUpdates, .reminders, .challenges, .discovery, .calendarInvites]
        }
    }

    /// Default switch when the member has no stored value. Categories a channel does not offer are false.
    public static func defaultEnabled(_ category: DIPNotificationCategory, channel: DIPNotificationChannel) -> Bool {
        guard offered(on: channel).contains(category) else { return false }
        switch channel {
        case .push: return category != .social && category != .discovery
        case .email: return category == .invites || category == .eventUpdates || category == .challenges || category == .calendarInvites
        }
    }
}

/// Member overrides for `users/{uid}/settings/notifications`; anything not overridden resolves to the default.
public struct DIPNotificationPreferences: Equatable, Sendable {
    public static let contractVersion = 1
    public static let defaults = DIPNotificationPreferences()

    private var push: [DIPNotificationCategory: Bool] = [:]
    private var email: [DIPNotificationCategory: Bool] = [:]

    public init() {}

    /// Tolerant parse: unknown keys, non-Bool values and categories the channel does not offer are ignored.
    public init(firestore data: [String: Any]?) {
        for channel in DIPNotificationChannel.allCases {
            guard let map = data?[channel.rawValue] as? [String: Any] else { continue }
            var overrides: [DIPNotificationCategory: Bool] = [:]
            for category in DIPNotificationCategory.offered(on: channel) {
                // Bool-only: a bridged NSNumber 0/1 must not count, so check for the CFBoolean type.
                if let number = map[category.rawValue] as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() {
                    overrides[category] = number.boolValue
                }
            }
            set(overrides, on: channel)
        }
    }

    public func isEnabled(_ category: DIPNotificationCategory, on channel: DIPNotificationChannel) -> Bool {
        guard DIPNotificationCategory.offered(on: channel).contains(category) else { return false }
        return overrides(on: channel)[category] ?? DIPNotificationCategory.defaultEnabled(category, channel: channel)
    }

    /// Returns a copy with the switch set; categories the channel does not offer are ignored.
    public func setting(_ category: DIPNotificationCategory, on channel: DIPNotificationChannel, to value: Bool) -> Self {
        guard DIPNotificationCategory.offered(on: channel).contains(category) else { return self }
        var copy = self
        var map = overrides(on: channel)
        map[category] = value
        copy.set(map, on: channel)
        return copy
    }

    /// Document body with every offered switch resolved. The caller adds `updatedAt` as a server timestamp.
    public func firestoreFields() -> [String: Any] {
        var fields: [String: Any] = ["contractVersion": Self.contractVersion]
        for channel in DIPNotificationChannel.allCases {
            var map: [String: Bool] = [:]
            for category in DIPNotificationCategory.offered(on: channel) {
                map[category.rawValue] = isEnabled(category, on: channel)
            }
            fields[channel.rawValue] = map
        }
        return fields
    }

    private func overrides(on channel: DIPNotificationChannel) -> [DIPNotificationCategory: Bool] {
        channel == .push ? push : email
    }

    private mutating func set(_ map: [DIPNotificationCategory: Bool], on channel: DIPNotificationChannel) {
        if channel == .push { push = map } else { email = map }
    }
}
