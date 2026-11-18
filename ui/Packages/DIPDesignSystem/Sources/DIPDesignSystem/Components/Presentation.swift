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

    public var displayTitle: String {
        title.nonempty
            ?? String(
                localized: "ds.eventCard.untitled", defaultValue: "Untitled event", bundle: .module,
                comment: "Event card title fallback when the event has no title")
    }
    public var displayDate: String {
        dateText.nonempty
            ?? String(
                localized: "ds.eventCard.dateTbc", defaultValue: "Date to be confirmed", bundle: .module,
                comment: "Event card date fallback when the event has no date yet")
    }
    public var displayLocality: String {
        locality.nonempty
            ?? String(
                localized: "ds.eventCard.locationTbc", defaultValue: "Location to be confirmed", bundle: .module,
                comment: "Event card location fallback when the event has no location yet")
    }
    public var attendanceText: String {
        guard let attendeeCount else {
            return String(
                localized: "ds.eventCard.attendeesUnavailable", defaultValue: "Attendees unavailable",
                bundle: .module, comment: "Event card attendance line when the attendee count is not available")
        }
        let count = max(0, attendeeCount)
        return String(
            localized: "ds.eventCard.attending", defaultValue: "\(count) attending", bundle: .module,
            comment: "Event card attendance line; %lld = number of people attending")
    }
    public var registrationText: String {
        switch registration {
        case .available: return ""
        case .joined:
            return String(
                localized: "ds.eventCard.joined", defaultValue: "Joined", bundle: .module,
                comment: "Event card status: the member has joined this event")
        case .unavailable:
            return String(
                localized: "ds.eventCard.registrationUnavailable", defaultValue: "Registration unavailable",
                bundle: .module, comment: "Event card status: joining this event is not possible")
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
    public var displayName: String {
        name.nonempty
            ?? String(
                localized: "ds.avatar.coworker", defaultValue: "Coworker", bundle: .module,
                comment: "Name fallback for a person without a display name")
    }
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
        guard totalCount > 0 else {
            return String(
                localized: "ds.avatarGroup.empty", defaultValue: "No attendees yet", bundle: .module,
                comment: "Spoken and visible label for an avatar group with nobody in it")
        }
        let names = visiblePeople.map(\.displayName)
        var parts = names
        if overflowCount > 0 {
            parts.append(
                String(
                    localized: "ds.avatarGroup.more", defaultValue: "\(overflowCount) more", bundle: .module,
                    comment: "Spoken avatar group overflow item; %lld = number of additional attendees not named"))
        }
        if parts.isEmpty {
            return String(
                localized: "ds.avatarGroup.count", defaultValue: "\(totalCount) attendees", bundle: .module,
                comment: "Spoken attendee total; %lld = number of attendees")
        }
        return String(
            localized: "ds.avatarGroup.countWithNames", defaultValue: "\(totalCount) attendees: \(parts.joined(separator: ", "))",
            bundle: .module,
            comment: "Spoken attendee total followed by names; %1$lld = number of attendees, %2$@ = comma separated names and overflow")
    }
}

public enum DIPDestination: String, CaseIterable, Identifiable, Sendable {
    case home, myEvents, profile
    public var id: Self { self }
    public var title: String {
        switch self {
        case .home: String(localized: "ds.tab.home", defaultValue: "Home", bundle: .module, comment: "Tab bar item: home")
        case .myEvents:
            String(localized: "ds.tab.myEvents", defaultValue: "My Events", bundle: .module, comment: "Tab bar item: the member's events")
        case .profile:
            String(localized: "ds.tab.profile", defaultValue: "Profile", bundle: .module, comment: "Tab bar item: profile")
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
