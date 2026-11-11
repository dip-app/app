import DIPCore
import SwiftUI

/// Review states for the redesigned Profile, driven by `--profile-state=<state>`:
/// `account` (full), `account-empty` (new member: no interests, details or memories),
/// `fixture-empty` (prototype profile with no memories) and `edit` (opens the edit form).
struct ProfileStatesPreview: View {
    let state: String

    static func launchState() -> String? {
        ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--profile-state=") }
            .map { String($0.dropFirst("--profile-state=".count)) }
    }

    private static let catalog: [DIPInterest] = [
        .init(id: "fitness", name: "Fitness", sortOrder: 1), .init(id: "cooking", name: "Cooking", sortOrder: 2),
        .init(id: "outdoors", name: "Outdoors", sortOrder: 3), .init(id: "games", name: "Board games", sortOrder: 4),
    ]

    private var profile: DIPProfile {
        let memories: [DIPFavoriteMemory] = [
            .init(id: "m0", eventID: "kayaking-memory", image: .asset("profile_Rectangle935"), dateLabel: "03/01", photoID: "4"),
            .init(id: "m1", eventID: "hiking-memory", image: .asset("profile_Rectangle931"), dateLabel: "02/10", photoID: "0"),
            .init(id: "m2", eventID: "rug-tuft", image: .asset("profile_Rectangle932"), dateLabel: "02/07", photoID: "3"),
            .init(id: "m3", eventID: "boat-ride", image: .asset("profile_Rectangle933"), dateLabel: "02/04", photoID: "1"),
        ]
        switch state {
        case "account-empty":
            return DIPProfile(
                id: "p", displayName: "Jordan Lee", department: "", city: "", interestTagIDs: [],
                interestCatalog: Self.catalog, photo: .asset("profile_Image"), avatar: .asset("profile_Image1"),
                favoriteMemories: [], jobTitle: "", availability: [], travelRadiusMiles: 20)
        case "fixture-empty":
            return DIPProfile(
                id: "p", displayName: "Elissa Woode", department: "Human Resources", city: "Pittsburgh, PA",
                interestTagIDs: ["fitness"], interestCatalog: Self.catalog, photo: .asset("profile_Image"),
                avatar: .asset("profile_Image1"), favoriteMemories: [])
        default:
            return DIPProfile(
                id: "p", displayName: "Jordan Lee", department: "Product Design", city: "Pittsburgh, PA",
                interestTagIDs: ["fitness", "cooking", "outdoors", "games"], interestCatalog: Self.catalog,
                photo: .asset("profile_Image"), avatar: .asset("profile_Image1"), favoriteMemories: memories,
                jobTitle: "Senior Designer", availability: ["weekday-lunch", "weekends"], travelRadiusMiles: 20)
        }
    }

    var body: some View {
        DIPProfileScreen(profile: profile, onSelectTab: { _ in }, onMemory: { _, _ in }, onSave: { _ in },
                         onSignOut: {})
    }
}
