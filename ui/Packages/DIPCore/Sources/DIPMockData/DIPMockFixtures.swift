import DIPCore
import Foundation

/// Exact existing prototype content, centralized behind the mock boundary.
/// IDs distinguish events; the shared reference album is intentionally reused by the prototype.
public enum DIPMockFixtures {
    /// Synthetic preview catalog. IDs are fixed independently of display names.
    public static let interestCatalog: [DIPInterest] = [
        ("tag-fitness", "Fitness"), ("tag-cooking", "Cooking"), ("tag-outdoors", "Outdoors"),
        ("tag-carpentry", "Carpentry"), ("tag-art", "Art"), ("tag-board-games", "Board Games"),
        ("tag-books", "Books"), ("tag-cycling", "Cycling"), ("tag-dancing", "Dancing"),
        ("tag-gardening", "Gardening"), ("tag-music", "Music"), ("tag-photography", "Photography"),
        ("tag-volunteering", "Volunteering")
    ].enumerated().map { index, item in DIPInterest(id: item.0, name: item.1, sortOrder: index) }

    /// Coherent, opt-in V1 development data. These venues and dates are synthetic;
    /// the original frame-comparison fixtures remain unchanged.
    public static func v1Events(now: Date = Date()) -> DIPAppSnapshot {
        var snapshot = reference
        let joinedIDs = Set(snapshot.activeEvents.map(\.id) + snapshot.memories.map(\.eventID))
        let orderedIDs = snapshot.eventDetails.keys.sorted()
        for (index, id) in orderedIDs.enumerated() {
            guard var event = snapshot.eventDetails[id] else { continue }
            let start = now.addingTimeInterval(Double(event.isPast ? -(index + 1) : index + 1) * 86_400)
            let locality = snapshot.home.events.first { $0.id == id }?.locality
                ?? snapshot.activeEvents.first { $0.id == id }?.locality
                ?? snapshot.memories.first { $0.eventID == id }?.locality ?? "Pittsburgh, PA"
            let venues = [("Schenley Park Visitor Center", "101 Panther Hollow Rd"), ("Allegheny Riverfront Park", "1 Allegheny Ave"),
                          ("The Yoga Studio", "4800 Liberty Ave"), ("Phipps Conservatory", "1 Schenley Dr"),
                          ("Lawrenceville Community Kitchen", "3600 Butler St"), ("Point State Park", "601 Commonwealth Pl")]
            let venue = venues[index % venues.count]
            event.metadata = .init(
                startTime: start, endTime: start.addingTimeInterval(5_400),
                venueName: venue.0, address: venue.1, locality: locality,
                costCents: index.isMultiple(of: 2) ? 0 : 2_000, costNote: "", capacity: 30)
            event.isJoined = joinedIDs.contains(id)
            event.timing = start.formatted(date: .abbreviated, time: .shortened)
            snapshot.eventDetails[id] = event
        }
        let lists = DIPEventLists(snapshot: snapshot, now: now)
        snapshot.home.events = lists.discovery
        snapshot.activeEvents = lists.upcoming
        snapshot.memories = lists.past
        return snapshot
    }

    /// V1 events where puppy-yoga carries many long interest tags (wrapping review).
    public static func manyTagsReview(now: Date = Date()) -> DIPAppSnapshot {
        var snapshot = v1Events(now: now)
        snapshot.eventDetails["puppy-yoga"]?.tags = [
            "Yoga", "Animals", "Wellness & mindfulness", "Outdoor adventures and hiking", "Board games", "Live music",
            "Food and cooking classes", "Volunteering", "Photography", "A really long interest name that needs wrapping"]
        return snapshot
    }

    public static var emptySocialReview: DIPAppSnapshot {
        var snapshot = reference
        for id in snapshot.messages.keys { snapshot.messages[id] = [] }
        snapshot.photoComments = [:]
        return snapshot
    }

    public static var chatGroupingReview: DIPAppSnapshot {
        var snapshot = reference
        let rows: [(String, String, TimeInterval)] = [
            ("frank-white", "Let's meet at the entrance.", 0),
            ("frank-white", "I'll bring the yoga mats.", 20),
            ("frank-white", "See you soon!", 40),
            (snapshot.profile.id, "Sounds good!", 60),
            (snapshot.profile.id, "I'll be there in ten minutes.", 80),
            ("frank-white", "We're all set for the activity.", 600)
        ]
        snapshot.messages["puppy-yoga"] = rows.enumerated().map { index, row in
            DIPMessage(id: "group-\(index)", authorID: row.0, text: row.1,
                authorName: row.0 == snapshot.profile.id ? snapshot.profile.displayName : "Frank White",
                authorAvatar: row.0 == snapshot.profile.id ? snapshot.profile.avatar : .asset("attendees_CoworkerProfilePicture1"),
                createdAt: Date(timeIntervalSince1970: 1_793_700_000 + row.2))
        }
        return snapshot
    }

    public static var chatHistoryReview: DIPAppSnapshot {
        var snapshot = reference
        snapshot.messages["puppy-yoga"] = (0..<35).map { index in
            DIPMessage(id: "history-\(index)", authorID: "frank-white", text: "Planning message \(index + 1): let's meet by the entrance before the activity.",
                authorName: "Frank White", authorAvatar: .asset("attendees_CoworkerProfilePicture1"),
                createdAt: Date(timeIntervalSince1970: 1_772_971_200 + Double(index * 60)))
        }
        return snapshot
    }

    public static var reference: DIPAppSnapshot {
        let homeEvents: [DIPEventSummary] = [
            .init(id: "puppy-yoga", title: "Puppy Yoga", locality: "Lawrenceville, PA", image: .asset("EventCard"), avatars: assets(["AvatarPink", "CoworkerProfilePicture1", "AvatarTeal"]), attendeeCount: 7, imageShade: 0.1),
            .init(id: "kayaking", title: "Kayaking", locality: "Delaware River, NJ", image: .asset("EventCard1"), avatars: assets(["CoworkerProfilePicture2", "AvatarRed", "CoworkerProfilePicture1"]), attendeeCount: 13, imageShade: 0.2),
            .init(id: "hike", title: "Hike", locality: "Poconos, PA", image: .asset("EventCard2"), avatars: assets(["CoworkerProfilePicture", "CoworkerProfilePicture2", "AvatarTeal"]), attendeeCount: 10, imageShade: 0.08)
        ]
        let active: [DIPEventSummary] = [
            .init(id: "puppy-yoga", title: "Puppy Yoga", locality: "Lawrenceville, PA", image: .asset("events_Rectangle930"), imageShade: 0.2),
            .init(id: "game-cafe", title: "Game cafe", locality: "Squirrel Hill, PA", image: .asset("events_Rectangle931"), imageShade: 0.08),
            .init(id: "mount-diablo-hike", title: "Mount Diablo Hike", locality: "Allegheny, PA", image: .asset("events_Rectangle932")),
            .init(id: "cooking-class", title: "Cooking class", locality: "Strip District, PA", image: .asset("events_Rectangle933"))
        ]
        let memoryRows: [(String, String, String, String, [String], Double)] = [
            ("kayaking-memory", "Kayaking 03/01", "Delaware River, NJ", "EventCard", ["AvatarPink", "AvatarRed", "AvatarTeal"], 0.08),
            ("hiking-memory", "Hiking 02/22", "Fall Run Park, PA", "EventCard1", ["CoworkerProfilePicture", "CoworkerProfilePicture1", "AvatarPink"], 0.2),
            ("rug-tuft", "Rug Tuft 02/15", "Poconos, PA", "EventCard2", ["CoworkerProfilePicture2", "CoworkerProfilePicture3", "CoworkerProfilePicture4"], 0.08),
            ("boat-ride", "Boat Ride 02/08", "Allegheny, PA", "EventCard3", ["AvatarRed", "CoworkerProfilePicture2", "AvatarTeal"], 0.08),
            ("rage-room", "Rage Room 02/01", "Southside, PA", "EventCard4", ["AvatarPink", "CoworkerProfilePicture1", "CoworkerProfilePicture"], 0.08),
            ("paint-sip", "Paint Sip 01/25", "Lawrenceville, PA", "EventCard5", ["CoworkerProfilePicture4", "AvatarRed", "CoworkerProfilePicture2"], 0.08),
            ("ceramics", "Ceramics 01/18", "Strip District, PA", "EventCard6", ["AvatarPink", "AvatarRed", "AvatarTeal"], 0.08),
            ("book-club", "Book Club 01/11", "Bloomfield, PA", "EventCard7", ["AvatarPink", "AvatarRed", "AvatarTeal"], 0.08)
        ]
        let memories = memoryRows.map { row in
            DIPMemory(id: row.0, eventID: row.0, title: row.1, locality: row.2, image: .asset("events-past_" + row.3), avatars: assets(row.4.map { "events-past_" + $0 }), imageShade: row.5)
        }
        let favorites: [DIPFavoriteMemory] = [
            .init(id: "favorite-0", eventID: "kayaking-memory", image: .asset("profile_Rectangle935"), dateLabel: "03/01"),
            .init(id: "favorite-1", eventID: "hiking-memory", image: .asset("profile_Rectangle931"), dateLabel: "02/10"),
            .init(id: "favorite-2", eventID: "rug-tuft", image: .asset("profile_Rectangle932"), dateLabel: "02/07"),
            .init(id: "favorite-3", eventID: "boat-ride", image: .asset("profile_Rectangle933"), dateLabel: "02/04"),
            .init(id: "favorite-4", eventID: "ceramics", image: .asset("profile_Rectangle934"), dateLabel: "01/07"),
            .init(id: "favorite-5", eventID: "book-club", image: .asset("profile_Rectangle936"), dateLabel: "12/30")
        ]
        let profile = DIPProfile(id: "elissa-woode", displayName: "Elissa Woode", department: "Human Resources", city: "Pittsburgh, PA", interestTagIDs: ["tag-fitness", "tag-cooking", "tag-outdoors", "tag-carpentry"], interestCatalog: interestCatalog, photo: .asset("profile_Image"), avatar: .asset("profile_Image1"), favoriteMemories: favorites)
        let puppyDescription = "Join us for a delightful puppy yoga session where you can stretch, relax, and bond with adorable puppies! Experience the joy of  yoga surrounded by puppies who will bring smiles and laughter to your practice. This session combines gentle yoga poses with the heartwarming presence of our furry friends."
        let detailRows: [(String, String, String, [String])] = [
            ("puppy-yoga", "Puppy Yoga", "event_Image", ["Fitness", "Energetic", "Hype"]),
            ("kayaking", "Kayaking", "EventCard1", ["Outdoors", "Adventure", "Fitness"]),
            ("hike", "Hike", "EventCard2", ["Outdoors", "Adventure", "Fitness"]),
            ("game-cafe", "Game Cafe", "events_Rectangle931", ["Games", "Social", "Fun"]),
            ("mount-diablo-hike", "Mount Diablo Hike", "events_Rectangle932", ["Outdoors", "Adventure", "Fitness"]),
            ("cooking-class", "Cooking Class", "events_Rectangle933", ["Cooking", "Social", "Fun"])
        ]
        var details: [String: DIPEventDetail] = [:]
        for (id, title, image, tags) in detailRows {
            details[id] = DIPEventDetail(id: id, title: title, image: .asset(image), timing: "Happening 3/09", description: id == "puppy-yoga" ? puppyDescription : "Spend time with your coworkers and enjoy \(title.lowercased()) together. Meet new people, share a fun experience, and make memories with your team.", tags: tags, attendeeCount: 16, attendeeAvatars: attendeeAvatars(eventID: id, going: false) ?? [])
        }
        for row in memoryRows {
            details[row.0] = DIPEventDetail(
                id: row.0, title: row.1.split(separator: " ").dropLast().joined(separator: " "),
                image: .asset("events-past_" + row.3), timing: row.0 == "kayaking-memory" ? "Friday 3/01" : String(row.1.split(separator: " ").last ?? ""),
                description: row.0 == "kayaking-memory" ? "Join us for an exciting kayaking trip on Crystal Lake! Paddle through beautiful scenery, spot local wildlife, and enjoy nature's tranquility. Whether you're a beginner or a pro, this adventure offers unforgettable memories!" : "",
                tags: row.0 == "kayaking-memory" ? ["Fitness", "Water Sport", "Bonding"] : [],
                attendeeCount: 13,
                attendeeAvatars: assets((3...7).map { "CoworkerProfilePicture\($0)" }),
                isPast: true)
        }
        let people = participants
        let photoAssets = ["Rectangle931", "Rectangle933", "Rectangle934", "Rectangle932", "Rectangle935", "Rectangle936", "Rectangle937", "Rectangle938", "Rectangle939", "Rectangle940", "Rectangle935", "Rectangle941"]
        let photos = photoAssets.enumerated().map { index, asset in
            DIPPhoto(id: "\(index)", image: .asset("album_" + asset), attribution: index == 0 ? .init(name: "Jane Gertskey", avatar: .asset("album_AvatarPurple")) : index == 8 ? .init(name: "Alexis Standall", avatar: .asset("album_AvatarTeal")) : nil)
        }
        let allIDs = detailRows.map(\.0) + memories.map(\.eventID)
        var albums: [String: DIPAlbum] = [:]
        var participantLists: [String: [DIPParticipant]] = [:]
        var messages: [String: [DIPMessage]] = [:]
        for id in allIDs {
            let title = details[id]?.title ?? memories.first(where: { $0.eventID == id })?.title ?? "Event"
            albums[id] = DIPAlbum(id: "album-" + id, eventID: id, title: title, photos: photos)
            participantLists[id] = details[id]?.isPast == true ? Array(people.prefix(13)) : people
            messages[id] = [.init(id: "initial-" + id, authorID: "frank-white", text: "Looking forward to this activity!", authorName: "Frank White", authorAvatar: .asset("attendees_CoworkerProfilePicture1"), createdAt: Date(timeIntervalSince1970: 1_772_971_200))]
        }
        let home = DIPHomeSnapshot(unreadCount: 5, profileAvatar: .asset("Image"), challenge: DIPChallengeFixtures.referenceSummary, events: homeEvents, recentAttendeeAvatars: assets((3...7).map { "CoworkerProfilePicture\($0)" }))
        return DIPAppSnapshot(home: home, activeEvents: active, memories: memories, profile: profile, eventDetails: details, participants: participantLists, albums: albums, messages: messages, challengeDetails: [DIPChallengeFixtures.referenceID: DIPChallengeFixtures.referenceDetail])
    }

    /// Opt-in interaction-review data; original frame fixtures remain unchanged.
    public static var photoCommentReview: DIPAppSnapshot {
        var snapshot = reference
        let longText = String(repeating: "A wonderful afternoon on the river with our coworkers. The scenery was beautiful and we should absolutely plan another trip together. ", count: 8)
        let texts = ["An earlier comment retained in the repository", "Loved this river trip", longText, "Perfect weather for kayaking", "We should go again soon"]
        snapshot.photoComments["kayaking-memory"] = ["0": texts.enumerated().map { index, text in
            DIPPhotoComment(id: "review-\(index)", authorID: "review-author-\(index)",
                authorName: "Coworker \(index)", authorAvatar: .asset(index.isMultiple(of: 2) ? "AvatarPink" : "AvatarTeal"),
                text: text, createdAt: Date(timeIntervalSince1970: 1_790_000_000 + Double(index)))
        }]
        return snapshot
    }

    /// Alternate artwork belongs to the reference provider, not the shared read model.
    /// Custom injected events retain their supplied avatar projection.
    static func attendeeAvatars(eventID: String, going: Bool) -> [MediaReference]? {
        guard ["puppy-yoga", "kayaking", "hike", "game-cafe", "mount-diablo-hike", "cooking-class"].contains(eventID) else { return nil }
        let prefix = going ? "event-joined_" : "event_"
        return assets((0..<4).map { prefix + "CoworkerProfilePicture" + ($0 == 0 ? "" : "\($0)") })
    }

    private static func assets(_ names: [String]) -> [MediaReference] { names.map(MediaReference.asset) }

    private static var participants: [DIPParticipant] {
        let rows: [(String, String)] = [
            ("Elissa Woode", "Human Resources"), ("Frank White", "Customer Support"), ("Linda Carter", "Marketing"),
            ("Michael Johnson", "User Experience Team"), ("Samantha Green", "Technical Assistance"),
            ("Robert Garcia", "Quality Assurance"), ("Patricia Lee", "Product Development"),
            ("Jessica Martinez", "Project Management"), ("Daniel Kim", "Sales"), ("Sophia Turner", "Data Analysis"),
            ("Kevin Brown", "Content Creation"), ("Emily Davis", "Finance"), ("Matthew Wilson", "IT Support"),
            ("Ava Thompson", "Business Strategy"), ("James Rodriguez", "Research and Development"),
            ("Olivia White", "Social Media Management"), ("Liam Harris", "Operations")
        ]
        return rows.enumerated().map { index, row in
            let avatarIndex = index % 8
            return DIPParticipant(id: row.0.lowercased().replacingOccurrences(of: " ", with: "-"), name: row.0, department: row.1, avatar: .asset("attendees_CoworkerProfilePicture" + (avatarIndex == 0 ? "" : "\(avatarIndex)")))
        }
    }
}
