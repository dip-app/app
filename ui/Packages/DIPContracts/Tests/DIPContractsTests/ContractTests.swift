import Foundation
import XCTest
@testable import DIPContracts

final class ContractTests: XCTestCase {
    func testSharedFixturesDecodeAndRoundTrip() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "happy-path", withExtension: "json", subdirectory: "Fixtures"))
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let fixtures = try decoder.decode(Fixtures.self, from: data)
        let roundTrip = try decoder.decode(Fixtures.self, from: encoder.encode(fixtures))
        XCTAssertEqual(roundTrip, fixtures)
        XCTAssertEqual(fixtures.setRsvpRequest.companyId, "company-demo")
        XCTAssertEqual(fixtures.event.revision, 1)
        XCTAssertEqual(fixtures.challenge.coverImageURL, "catalog://theme/fitness")
        XCTAssertEqual(fixtures.challenge.revision, 1)
        XCTAssertEqual(fixtures.createChallengeResponse.challenge, fixtures.challenge)
        XCTAssertEqual(fixtures.updateChallengeResponse.challenge.revision, 2)
    }
    private struct Fixtures: Codable, Equatable {
        let event: Event
        let setRsvpRequest: SetRsvpRequest
        let setRsvpResponse: SetRsvpResponse
        let resolveMembershipRequest: ResolveMembershipRequest
        let resolveMembershipResponse: ResolveMembershipResponse
        let createEventRequest: CreateEventRequest
        let createEventResponse: CreateEventResponse
        let updateEventRequest: UpdateEventRequest
        let updateEventResponse: UpdateEventResponse
        let challenge: Challenge
        let createChallengeRequest: CreateChallengeRequest
        let createChallengeResponse: CreateChallengeResponse
        let updateChallengeRequest: UpdateChallengeRequest
        let updateChallengeResponse: UpdateChallengeResponse
    }
}
