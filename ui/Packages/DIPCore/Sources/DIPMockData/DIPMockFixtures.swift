import DIPCore
import Foundation

/// Exact existing prototype content, centralized behind the mock boundary.
/// IDs distinguish events; the shared reference album is intentionally reused by the prototype.
public enum DIPMockFixtures {
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
        let profile = DIPProfile(id: "elissa-woode", displayName: "Elissa Woode", department: "Human Resources", city: "Pittsburgh, PA", interests: ["Fitness", "Cooking", "Outdoors", "Carpentry"], availableInterests: ["Fitness", "Cooking", "Outdoors", "Carpentry"], photo: .asset("profile_Image"), avatar: .asset("profile_Image1"), favoriteMemories: favorites)
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
        let home = DIPHomeSnapshot(unreadCount: 5, profileAvatar: .asset("Image"), challenge: .init(id: "fitness-challenge", category: "Fitness", participantCount: 128, avatars: assets(["CoworkerProfilePicture", "AvatarRed", "AvatarTeal"]), artwork: .asset("Mascot")), events: homeEvents, recentAttendeeAvatars: assets((3...7).map { "CoworkerProfilePicture\($0)" }))
        return DIPAppSnapshot(home: home, activeEvents: active, memories: memories, profile: profile, eventDetails: details, participants: participantLists, albums: albums, messages: messages)
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
