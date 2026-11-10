import DIPContracts
import DIPCore
import DIPMockData
import SwiftUI

/// SDK-free review host for every Home weekly-theme state, through the real feed and repository
/// with a fake source (never Firebase). Launch with:
///   --home-theme=live|none|error|loading|offline|unknown   [--home-theme-count=0|1|128]
/// `error` fails the first read only, so "Try again" recovers in place.
@MainActor struct HomeThemePreview: View {
    let mode: String
    let count: Int
    private let scope = ChallengeReadScope(uid: "preview-member", companyID: "preview-company")

    static func launchMode(_ arguments: [String] = ProcessInfo.processInfo.arguments) -> (mode: String, count: Int)? {
        guard let mode = arguments.first(where: { $0.hasPrefix("--home-theme=") })?.dropFirst("--home-theme=".count) else { return nil }
        let count = arguments.first { $0.hasPrefix("--home-theme-count=") }.flatMap { Int($0.dropFirst("--home-theme-count=".count)) }
        return (String(mode), count ?? 128)
    }

    var body: some View {
        WeeklyChallengeHost(makeRepository: { [scope, mode, count] in
            MemberChallengesRepository(scope: scope, source: PreviewChallengeSource(mode: mode, count: count), currentUID: { scope.uid })
        }) {
            DIPHomeFixturePreview()
        }
    }
}

@MainActor private final class PreviewChallengeSource: ChallengeReadSource {
    let mode: String
    let count: Int
    private var serverReads = 0
    init(mode: String, count: Int) { self.mode = mode; self.count = count }

    private func record() -> DIPContracts.Challenge {
        let theme = DIPChallengeFixtures.fitness(participantCount: count, relativeTo: Date())
        let unknown = mode == "unknown"
        return DIPContracts.Challenge(
            id: theme.id, companyId: "preview-company", title: unknown ? "Sleep" : theme.title, description: theme.description,
            tagIds: [], type: theme.type, goal: theme.goal, goalUnit: theme.goalUnit,
            coverImageURL: unknown ? "catalog://theme/sleep" : theme.coverImageURL,
            startDate: theme.startDate, endDate: theme.endDate, pointsReward: theme.pointsReward,
            participantCount: theme.participantCount, completedCount: 0)
    }

    func challenges(scope: ChallengeReadScope, query: ChallengeWindowQuery, origin: ChallengeReadOrigin) async throws -> [DIPContracts.Challenge] {
        if origin == .cache { return mode == "offline" ? [record()] : [] }
        serverReads += 1
        switch mode {
        case "loading": try await Task.sleep(for: .seconds(3600)); return []
        case "none": return []
        case "offline": throw ChallengeReadFailure.unavailable
        case "error" where serverReads == 1: throw ChallengeReadFailure.unavailable
        default: return [record()]
        }
    }
    func stop() {}
}
