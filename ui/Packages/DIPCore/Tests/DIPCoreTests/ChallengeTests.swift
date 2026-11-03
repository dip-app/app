import DIPCore
import DIPMockData
import XCTest

final class ChallengeTests: XCTestCase {
    func testFixtureChallengeMatchesHomeCardAndJoinsAndLeaves() async throws {
        let repository = DIPMockRepository()
        let initial = await repository.currentSnapshot()
        let challenge = try XCTUnwrap(initial.challengeDetails[try XCTUnwrap(initial.home.challenge).id])
        XCTAssertFalse(challenge.isJoined)

        try await repository.setChallengeJoined(challengeID: challenge.id, joined: true)
        var snapshot = await repository.currentSnapshot()
        XCTAssertEqual(snapshot.challengeDetails[challenge.id]?.isJoined, true)

        try await repository.setChallengeJoined(challengeID: challenge.id, joined: true)
        try await repository.setChallengeJoined(challengeID: challenge.id, joined: false)
        snapshot = await repository.currentSnapshot()
        XCTAssertEqual(snapshot.challengeDetails[challenge.id]?.isJoined, false)
    }

    func testUnknownChallengeIsRejected() async {
        let repository = DIPMockRepository()
        do {
            try await repository.setChallengeJoined(challengeID: "missing", joined: true)
            XCTFail("Unknown challenge must be rejected")
        } catch { XCTAssertEqual(error as? DIPRepositoryError, .notFound("missing")) }
    }
}
