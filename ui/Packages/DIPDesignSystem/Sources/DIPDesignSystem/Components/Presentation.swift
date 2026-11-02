import Foundation

/// Display strings are formatted/localized by the feature, never by a Firebase-aware view.
public struct DIPEventCardContent: Equatable, Sendable {
    public enum Registration: String, Equatable, Sendable { case available, joined, unavailable }
    public var title: String
    public var dateText: String
    public var locality: String
    public var attendeeCount: Int?
    public var registration: Registration

    public init(
        title: String, dateText: String, locality: String, attendeeCount: Int? = nil,
        registration: Registration = .available
    ) {
        self.title = title
        self.dateText = dateText
        self.locality = locality
        self.attendeeCount = attendeeCount
        self.registration = registration
    }

    public var displayTitle: String { title.nonempty ?? "Untitled event" }
    public var displayDate: String { dateText.nonempty ?? "Date to be confirmed" }
    public var displayLocality: String { locality.nonempty ?? "Location to be confirmed" }
    public var attendanceText: String {
        guard let attendeeCount else { return "Attendees unavailable" }
        let count = max(0, attendeeCount)
        return count == 1 ? "1 attending" : "\(count) attending"
    }
    public var registrationText: String {
        switch registration {
        case .available: return ""
        case .joined: return "Joined"
        case .unavailable: return "Registration unavailable"
        }
    }
    public var accessibilityLabel: String {
        [displayTitle, displayDate, displayLocality, attendanceText].joined(separator: ", ")
    }
}

public struct DIPAvatarIdentity: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
    public var displayName: String { name.nonempty ?? "Coworker" }
    public var initials: String {
        name.split(whereSeparator: { $0.isWhitespace }).prefix(2).compactMap(\.first).map(String.init).joined()
            .uppercased()
    }
}

/// Deduplicates known people and does not invent identities for the overflow count.
public struct DIPAvatarGroupSummary: Equatable, Sendable {
    public let visiblePeople: [DIPAvatarIdentity]
    public let overflowCount: Int
    public let totalCount: Int
    public init(people: [DIPAvatarIdentity], totalCount: Int? = nil, maximumVisible: Int = 3) {
        var seen: Set<String> = []
        let unique = people.filter { seen.insert($0.id).inserted }
        self.totalCount = max(unique.count, totalCount ?? unique.count, 0)
        self.visiblePeople = Array(unique.prefix(max(0, maximumVisible)))
        self.overflowCount = max(0, self.totalCount - visiblePeople.count)
    }
    public var accessibilityLabel: String {
        guard totalCount > 0 else { return "No attendees yet" }
        let names = visiblePeople.map(\.displayName)
        var parts = names
        if overflowCount > 0 { parts.append("\(overflowCount) more") }
        let count = totalCount == 1 ? "1 attendee" : "\(totalCount) attendees"
        return parts.isEmpty ? count : count + ": " + parts.joined(separator: ", ")
    }
}

public enum DIPDestination: String, CaseIterable, Identifiable, Sendable {
    case home, myEvents, profile
    public var id: Self { self }
    public var title: String {
        switch self {
        case .home: "Home"
        case .myEvents: "My Events"
        case .profile: "Profile"
        }
    }
    /// Native symbols deliberately replace prototype Heroicons; calendar addresses the research finding.
    public var systemImage: String {
        switch self {
        case .home: "house.fill"
        case .myEvents: "calendar"
        case .profile: "person.crop.circle"
        }
    }
}

extension String {
    fileprivate var nonempty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
