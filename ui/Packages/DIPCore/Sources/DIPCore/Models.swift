import Foundation

/// Presentation-independent media identity. Asset names are resolved by the UI's resource bundle.
public enum MediaReference: Equatable, Sendable {
    case asset(String)
    case remote(URL)
    case data(Data)
    /// The app-assigned avatar for a user id (shape, mood and colour from a stable hash); no photo needed.
    case generatedAvatar(userID: String)
}

public struct DIPEventSummary: Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var locality: String
    public var image: MediaReference
    public var avatars: [MediaReference]
    public var attendeeCount: Int
    public var imageShade: Double
    public init(id: String, title: String, locality: String, image: MediaReference, avatars: [MediaReference] = [], attendeeCount: Int = 0, imageShade: Double = 0) {
        self.id = id; self.title = title; self.locality = locality; self.image = image
        self.avatars = avatars; self.attendeeCount = attendeeCount; self.imageShade = imageShade
    }
}

/// Home "This Week's Challenge" card. `category` is the stored title (the card uppercases it);
/// artwork and accent come from `DIPThemeCatalog`, never from a photo URL.
public struct DIPChallengeSummary: Equatable, Sendable {
    public var id: String
    public var category: String
    public var participantCount: Int
    /// Participant faces. Empty when the source has none (v1 live data): the card then omits the stack.
    public var avatars: [MediaReference]
    /// Bundled theme illustration; nil for an unknown theme (title-only card).
    public var artwork: MediaReference?
    public var accent: DIPThemeAccent
    public init(id: String, category: String, participantCount: Int, avatars: [MediaReference] = [], artwork: MediaReference?, accent: DIPThemeAccent = .challenge) {
        self.id = id; self.category = category; self.participantCount = participantCount
        self.avatars = avatars; self.artwork = artwork; self.accent = accent
    }
    /// White-pill text: "+ 128 others participating", "+ 1 other participating", or the empty invitation.
    public var participationText: String { DIPChallengeText.participation(participantCount) }
    /// VoiceOver label for the whole card.
    public var accessibilityLabel: String {
        "This week’s challenge: \(category), \(DIPChallengeText.participationSpoken(participantCount))"
    }
}

/// Read-only detail projection of a weekly challenge (submissions are V2).
public struct DIPChallengeDetail: Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var image: MediaReference?
    /// Week window, for example "Nov 9 - Nov 15".
    public var timing: String
    public var description: String
    public var tags: [String]
    public var isJoined: Bool
    public var completedCount: Int
    public var completedAvatars: [MediaReference]
    /// "3 workouts"; nil when the source has no goal.
    public var goalText: String?
    /// "+50 points"; nil when the theme awards no points.
    public var rewardText: String?
    public var accent: DIPThemeAccent
    public init(id: String, title: String, image: MediaReference?, timing: String, description: String, tags: [String], isJoined: Bool = false, completedCount: Int = 0, completedAvatars: [MediaReference] = [], goalText: String? = nil, rewardText: String? = nil, accent: DIPThemeAccent = .challenge) {
        self.id = id; self.title = title; self.image = image; self.timing = timing; self.description = description
        self.tags = tags; self.isJoined = isJoined; self.completedCount = completedCount; self.completedAvatars = completedAvatars
        self.goalText = goalText; self.rewardText = rewardText; self.accent = accent
    }
}

public struct DIPHomeSnapshot: Equatable, Sendable {
    public var unreadCount: Int
    public var profileAvatar: MediaReference
    public var challenge: DIPChallengeSummary?
    public var events: [DIPEventSummary]
    public var recentAttendeeAvatars: [MediaReference]
    public init(unreadCount: Int, profileAvatar: MediaReference, challenge: DIPChallengeSummary?, events: [DIPEventSummary], recentAttendeeAvatars: [MediaReference]) {
        self.unreadCount = unreadCount; self.profileAvatar = profileAvatar; self.challenge = challenge
        self.events = events; self.recentAttendeeAvatars = recentAttendeeAvatars
    }
}

public struct DIPMemory: Identifiable, Equatable, Sendable {
    public var id: String
    public var eventID: String
    public var title: String
    public var locality: String
    public var image: MediaReference
    public var avatars: [MediaReference]
    public var imageShade: Double
    public init(id: String, eventID: String, title: String, locality: String, image: MediaReference, avatars: [MediaReference], imageShade: Double = 0.08) {
        self.id = id; self.eventID = eventID; self.title = title; self.locality = locality
        self.image = image; self.avatars = avatars; self.imageShade = imageShade
    }
}

public struct DIPFavoriteMemory: Identifiable, Equatable, Sendable {
    public var id: String
    public var eventID: String
    public var image: MediaReference
    public var dateLabel: String
    /// The album photo this memory is, so a tap lands in the viewer on that photo. nil opens the album.
    public var photoID: String?
    public init(id: String, eventID: String, image: MediaReference, dateLabel: String, photoID: String? = nil) {
        self.id = id; self.eventID = eventID; self.image = image; self.dateLabel = dateLabel; self.photoID = photoID
    }
}

/// Shared catalog projection of tags/{tagId}; id comes from snapshot metadata.
public struct DIPInterest: Identifiable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var icon: String
    public var sortOrder: Int
    public init(id: String, name: String, icon: String = "tag", sortOrder: Int = 0) {
        self.id = id; self.name = name; self.icon = icon; self.sortOrder = sortOrder
    }
}

public struct DIPProfile: Identifiable, Equatable, Sendable {
    public var id: String
    public var displayName: String
    public var department: String
    public var city: String
    public var interestTagIDs: [String]
    public var interestCatalog: [DIPInterest]
    public var selectedInterests: [DIPInterest] {
        var seen = Set<String>()
        return interestTagIDs.filter { seen.insert($0).inserted }.map { id in
            interestCatalog.first { $0.id == id } ?? DIPInterest(id: id, name: "Unavailable interest", sortOrder: Int.max)
        }
    }
    public var interests: [String] { selectedInterests.map(\.name) }
    public var photo: MediaReference
    public var avatar: MediaReference
    public var favoriteMemories: [DIPFavoriteMemory]
    /// Account-backed details. Fixture profiles leave `travelRadiusMiles` nil, and screens
    /// then hide job title, availability and radius entirely.
    public var jobTitle: String
    /// Stable availability ids (e.g. "weekends"); labels belong to presentation.
    public var availability: [String]
    public var travelRadiusMiles: Int?
    public var hasAccountDetails: Bool { travelRadiusMiles != nil }
    public init(id: String, displayName: String, department: String, city: String, interestTagIDs: [String], interestCatalog: [DIPInterest], photo: MediaReference, avatar: MediaReference, favoriteMemories: [DIPFavoriteMemory], jobTitle: String = "", availability: [String] = [], travelRadiusMiles: Int? = nil) {
        self.id = id; self.displayName = displayName; self.department = department; self.city = city
        self.interestTagIDs = interestTagIDs; self.interestCatalog = interestCatalog; self.photo = photo
        self.avatar = avatar; self.favoriteMemories = favoriteMemories
        self.jobTitle = jobTitle; self.availability = availability; self.travelRadiusMiles = travelRadiusMiles
    }
}

/// Editable metadata uses stable tag IDs, never localized display names.
public struct ProfileEdit: Equatable, Sendable {
    public var department: String
    public var city: String
    public var interestTagIDs: [String]
    /// nil leaves the stored value unchanged (the interest picker, for example, saves
    /// interests only and must not clear job title, availability or radius).
    public var jobTitle: String?
    public var availability: [String]?
    public var travelRadiusMiles: Int?
    public init(department: String, city: String, interestTagIDs: [String], jobTitle: String? = nil,
                availability: [String]? = nil, travelRadiusMiles: Int? = nil) {
        self.department = department; self.city = city; self.interestTagIDs = interestTagIDs
        self.jobTitle = jobTitle; self.availability = availability; self.travelRadiusMiles = travelRadiusMiles
    }
}

public struct DIPEventDetail: Identifiable, Equatable, Sendable {
    public var metadata: DIPEventMetadata?
    /// Presentation projection of an event whose end time has passed.
    public var isPast: Bool
    public var id: String
    public var title: String
    public var image: MediaReference
    public var timing: String
    public var description: String
    public var tags: [String]
    public var isJoined: Bool
    public var attendeeCount: Int
    public var attendeeAvatars: [MediaReference]
    public var attendeeOverflowCount: Int { max(0, attendeeCount - attendeeAvatars.count) }
    public init(id: String, title: String, image: MediaReference, timing: String, description: String, tags: [String], isJoined: Bool = false, attendeeCount: Int = 0, attendeeAvatars: [MediaReference], isPast: Bool = false, metadata: DIPEventMetadata? = nil) {
        self.metadata = metadata
        self.isPast = isPast
        self.id = id; self.title = title; self.image = image; self.timing = timing; self.description = description
        self.tags = tags; self.isJoined = isJoined; self.attendeeCount = attendeeCount
        self.attendeeAvatars = attendeeAvatars
    }
}

public struct DIPParticipant: Identifiable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var department: String
    /// Optional; empty when the member has not set one (older RSVP snapshots).
    public var jobTitle: String
    public var avatar: MediaReference
    public init(id: String, name: String, department: String, avatar: MediaReference, jobTitle: String = "") {
        self.id = id; self.name = name; self.department = department; self.avatar = avatar; self.jobTitle = jobTitle
    }

    /// One-line subtitle for attendee rows: "Job title · Department", only the parts that exist.
    public var subtitle: String {
        [jobTitle, department].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

public struct DIPPhotoAttribution: Equatable, Sendable {
    public var name: String
    public var avatar: MediaReference
    public init(name: String, avatar: MediaReference) { self.name = name; self.avatar = avatar }
}

public struct DIPPhoto: Identifiable, Equatable, Sendable {
    public var id: String
    public var image: MediaReference
    public var attribution: DIPPhotoAttribution?
    public var isImported: Bool
    public init(id: String, image: MediaReference, attribution: DIPPhotoAttribution? = nil, isImported: Bool = false) {
        self.id = id; self.image = image; self.attribution = attribution; self.isImported = isImported
    }
}

public struct DIPAlbum: Identifiable, Equatable, Sendable {
    public var id: String
    public var eventID: String
    public var title: String
    public var photos: [DIPPhoto]
    public init(id: String, eventID: String, title: String, photos: [DIPPhoto]) {
        self.id = id; self.eventID = eventID; self.title = title; self.photos = photos
    }
}

public struct PhotoUpload: Identifiable, Equatable, Sendable {
    /// Caller-generated identity is retained to make a repeated local import idempotent.
    public var id: String
    public var data: Data
    public init(id: String = UUID().uuidString, data: Data) { self.id = id; self.data = data }
}

public struct DIPMessage: Identifiable, Equatable, Sendable {
    public var id: String
    public var authorID: String
    public var authorName: String
    public var authorAvatar: MediaReference
    public var text: String
    public var createdAt: Date
    /// Added defaults preserve legacy fixture initialization; adapters should supply attribution and time.
    public init(id: String, authorID: String, text: String, authorName: String = "", authorAvatar: MediaReference = .data(Data()), createdAt: Date = .distantPast) {
        self.id = id; self.authorID = authorID; self.text = text
        self.authorName = authorName; self.authorAvatar = authorAvatar; self.createdAt = createdAt
    }
}

public struct DIPPhotoComment: Identifiable, Equatable, Sendable {
    public var id: String
    public var authorID: String
    public var authorName: String
    public var authorAvatar: MediaReference
    public var text: String
    public var createdAt: Date
    public init(id: String, authorID: String, authorName: String, authorAvatar: MediaReference, text: String, createdAt: Date) {
        self.id = id; self.authorID = authorID; self.authorName = authorName
        self.authorAvatar = authorAvatar; self.text = text; self.createdAt = createdAt
    }
}

/// App read projection, not a wire document or a request to fetch a tenant wholesale.
public struct DIPAppSnapshot: Equatable, Sendable {
    public var home: DIPHomeSnapshot
    public var activeEvents: [DIPEventSummary]
    public var memories: [DIPMemory]
    public var profile: DIPProfile
    public var eventDetails: [String: DIPEventDetail]
    public var participants: [String: [DIPParticipant]]
    public var albums: [String: DIPAlbum]
    public var messages: [String: [DIPMessage]]
    public var photoComments: [String: [String: [DIPPhotoComment]]]
    public var challengeDetails: [String: DIPChallengeDetail]
    public init(home: DIPHomeSnapshot, activeEvents: [DIPEventSummary], memories: [DIPMemory], profile: DIPProfile, eventDetails: [String: DIPEventDetail], participants: [String: [DIPParticipant]], albums: [String: DIPAlbum], messages: [String: [DIPMessage]], photoComments: [String: [String: [DIPPhotoComment]]] = [:], challengeDetails: [String: DIPChallengeDetail] = [:]) {
        self.challengeDetails = challengeDetails
        self.home = home; self.activeEvents = activeEvents; self.memories = memories; self.profile = profile
        self.eventDetails = eventDetails; self.participants = participants; self.albums = albums; self.messages = messages; self.photoComments = photoComments
    }
}
