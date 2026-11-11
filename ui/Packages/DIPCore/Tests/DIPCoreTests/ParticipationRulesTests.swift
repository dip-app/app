import DIPCore
import Foundation
import XCTest

final class ParticipationRulesTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_800_000_000)
    private func metadata(capacity: Int = 10, status: DIPEventStatus = .scheduled) -> DIPEventMetadata {
        .init(startTime: start, endTime: start.addingTimeInterval(3_600), venueName: "V", address: "A", locality: "L",
              costCents: 0, capacity: capacity, status: status)
    }
    private var before: Date { start.addingTimeInterval(-60) }

    func testJoinDenials() {
        XCTAssertNil(DIPParticipationRules.joinDenial(metadata(), attendeeCount: 9, isGoing: false, now: before))
        XCTAssertEqual(DIPParticipationRules.joinDenial(metadata(), attendeeCount: 10, isGoing: false, now: before), .full)
        XCTAssertEqual(DIPParticipationRules.joinDenial(metadata(), attendeeCount: 1, isGoing: true, now: before), .alreadyGoing)
        XCTAssertEqual(DIPParticipationRules.joinDenial(metadata(status: .cancelled), attendeeCount: 0, isGoing: false, now: before), .cancelled)
        XCTAssertEqual(DIPParticipationRules.joinDenial(metadata(), attendeeCount: 0, isGoing: false, now: start), .started)
        XCTAssertEqual(DIPParticipationRules.joinDenial(metadata(), attendeeCount: 0, isGoing: false, now: start.addingTimeInterval(3_600)), .ended)
    }

    func testCompletedEventsAreClosedToJoiningAndLeaving() {
        XCTAssertEqual(DIPParticipationRules.joinDenial(metadata(status: .completed), attendeeCount: 0, isGoing: false, now: before), .ended)
        XCTAssertEqual(DIPParticipationRules.leaveDenial(metadata(status: .completed), isGoing: true, now: before), .ended)
        XCTAssertEqual(metadata(status: .completed).state(now: before, attendeeCount: 0, isJoined: true), .past)
        XCTAssertFalse(metadata(status: .completed).canCancel(now: before))
    }

    func testLeaveDenials() {
        XCTAssertNil(DIPParticipationRules.leaveDenial(metadata(), isGoing: true, now: before))
        XCTAssertEqual(DIPParticipationRules.leaveDenial(metadata(), isGoing: false, now: before), .notGoing)
        XCTAssertEqual(DIPParticipationRules.leaveDenial(metadata(), isGoing: true, now: start), .started)
        XCTAssertEqual(DIPParticipationRules.leaveDenial(metadata(status: .cancelled), isGoing: true, now: before), .cancelled)
        XCTAssertTrue(DIPRsvpDenial.full.message.contains("full"))
    }

    func testOptimisticJoinShowsAtOnceAndConfirms() {
        var state = DIPOptimisticRSVP(going: false, attendeeCount: 3)
        XCTAssertTrue(state.begin(going: true, requestID: "a"))
        XCTAssertTrue(state.isGoing); XCTAssertEqual(state.attendeeCount, 4)
        state.succeed(requestID: "a", serverCount: 4)
        XCTAssertTrue(state.isGoing); XCTAssertEqual(state.attendeeCount, 4); XCTAssertNil(state.pending)
    }

    func testFailureRollsBackAndStaleResultsAreIgnored() {
        var state = DIPOptimisticRSVP(going: false, attendeeCount: 3)
        state.begin(going: true, requestID: "a")
        XCTAssertTrue(state.fail(requestID: "a"))
        XCTAssertFalse(state.isGoing); XCTAssertEqual(state.attendeeCount, 3)

        state.begin(going: true, requestID: "b")
        state.begin(going: false, requestID: "c")      // latest intent wins
        XCTAssertFalse(state.isGoing)
        XCTAssertFalse(state.fail(requestID: "b"))      // stale result: no rollback
        state.succeed(requestID: "b", serverCount: 9)    // stale ack: ignored
        XCTAssertEqual(state.pending?.requestID, "c")
        state.succeed(requestID: "c", serverCount: 3)
        XCTAssertFalse(state.isGoing); XCTAssertEqual(state.attendeeCount, 3)
    }

    func testSameStateIsIdempotent() {
        var state = DIPOptimisticRSVP(going: true, attendeeCount: 5)
        XCTAssertFalse(state.begin(going: true, requestID: "a"))
        XCTAssertNil(state.pending)
    }

    func testObservedStateReconciles() {
        var state = DIPOptimisticRSVP(going: false, attendeeCount: 3)
        state.begin(going: true, requestID: "a")
        state.observe(going: false, attendeeCount: 3)    // stale pre-write snapshot keeps the optimistic state
        XCTAssertTrue(state.isGoing); XCTAssertEqual(state.attendeeCount, 4)
        state.observe(going: true, attendeeCount: 4)     // server caught up
        XCTAssertNil(state.pending); XCTAssertTrue(state.isGoing); XCTAssertEqual(state.attendeeCount, 4)
        var other = DIPOptimisticRSVP(going: true, attendeeCount: 5)
        other.observe(going: false, attendeeCount: 4)    // changed elsewhere, nothing in flight
        XCTAssertFalse(other.isGoing); XCTAssertEqual(other.attendeeCount, 4)
    }
}
