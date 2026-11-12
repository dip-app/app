import DIPMockData
import Foundation
import Testing
@testable import DIPCore

@Suite struct InviteRulesTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func metadata(start: TimeInterval = 3_600, end: TimeInterval = 7_200, capacity: Int = 10, status: DIPEventStatus = .scheduled) -> DIPEventMetadata {
        DIPEventMetadata(startTime: now.addingTimeInterval(start), endTime: now.addingTimeInterval(end), venueName: "Park", address: "1 Main",
                         locality: "Town", costCents: 0, costNote: "", capacity: capacity, status: status, revision: 1)
    }

    @Test func denialMirrorsTheServerChecks() {
        #expect(DIPInviteRules.denial(metadata(), attendeeCount: 3, now: now) == nil)
        #expect(DIPInviteRules.denial(metadata(status: .cancelled), attendeeCount: 3, now: now) == .cancelled)
        #expect(DIPInviteRules.denial(metadata(start: -60, end: 600), attendeeCount: 3, now: now) == .started)
        #expect(DIPInviteRules.denial(metadata(start: -7_200, end: -60), attendeeCount: 3, now: now) == .ended)
        #expect(DIPInviteRules.denial(metadata(capacity: 3), attendeeCount: 3, now: now) == .full)
        #expect(DIPInviteRules.denial(metadata(capacity: 3), attendeeCount: 2, now: now) == nil)
    }

    @Test func searchTermNeedsTwoCharactersAndFitsTheContract() {
        #expect(DIPInviteRules.searchTerm("a") == nil)
        #expect(DIPInviteRules.searchTerm("  p ") == nil)
        #expect(DIPInviteRules.searchTerm(" pr ") == "pr")
        #expect(DIPInviteRules.searchTerm(String(repeating: "x", count: 41)) == nil)
    }

    @Test func noteIsTrimmedAndCapped() {
        #expect(DIPInviteRules.note("  hi  ") == "hi")
        #expect(DIPInviteRules.note(String(repeating: "x", count: 300)).count == 200)
        #expect(DIPInviteRules.note("   ") == "")
    }

    @Test func requestIDsMatchTheWireFormatAndAreUnique() {
        let a = DIPInviteRules.newRequestID(), b = DIPInviteRules.newRequestID()
        #expect(a != b)
        #expect(a.range(of: "^[A-Za-z0-9_-]{8,128}$", options: .regularExpression) != nil)
    }

    @Test func failuresHaveUserTextAndRetryAdvice() {
        for failure in [DIPInviteFailure.alreadyInvited, .alreadyGoing, .alreadyAnswered, .full, .closed, .cancelled, .notFound, .rateLimited, .notMember, .unauthenticated, .offline, .unknown] {
            #expect(!failure.message.isEmpty)
        }
        #expect(DIPInviteFailure.offline.isRetryable)
        #expect(DIPInviteFailure.rateLimited.isRetryable)
        #expect(!DIPInviteFailure.full.isRetryable)
        #expect(!DIPInviteFailure.alreadyGoing.isRetryable)
    }
}

@Suite struct InviteInboxTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func invite(_ id: String, start: TimeInterval, status: DIPInviteStatus = .pending, created: TimeInterval = 0) -> DIPInvite {
        DIPInvite(id: id, eventID: "e-\(id)", eventTitle: "Event \(id)", eventStart: now.addingTimeInterval(start), personID: "p-\(id)",
                  personName: "Person \(id)", status: status, createdAt: now.addingTimeInterval(created))
    }

    @Test func pendingListsUpcomingInvitesSoonestFirstAndDropsAnsweredAndStarted() {
        let inbox = DIPInviteInbox(DIPInvites(received: [
            invite("late", start: 9_000), invite("soon", start: 1_000), invite("declined", start: 2_000, status: .declined),
            invite("started", start: -10), invite("accepted", start: 3_000, status: .accepted),
        ]), now: now)
        #expect(inbox.pending.map(\.id) == ["soon", "late"])
        #expect(inbox.accepted.map(\.id) == ["accepted"])
        #expect(inbox.badgeCount == 2)
        #expect(!inbox.isEmptyReceived)
    }

    @Test func acceptedInvitesSplitByTheMembersCurrentRSVP() {
        let invites = DIPInvites(received: [
            invite("going", start: 1_000, status: .accepted), invite("left", start: 2_000, status: .accepted),
            invite("unknown", start: 3_000, status: .accepted), invite("pastLeft", start: -50, status: .accepted),
            invite("pending", start: 4_000), invite("declined", start: 5_000, status: .declined),
        ])
        let inbox = DIPInviteInbox(invites, now: now, rsvp: { ["e-going": true, "e-left": false, "e-pastLeft": false][$0] })
        #expect(inbox.accepted.map(\.id) == ["going", "unknown"])   // unknown is never guessed as cancelled
        #expect(inbox.cancelled.map(\.id) == ["left"])               // past events disappear from both sections
        #expect(inbox.pending.map(\.id) == ["pending"])
        #expect(inbox.badgeCount == 1)
        #expect(!inbox.isEmptyReceived)
        #expect(DIPInviteInbox(DIPInvites(received: [invite("left", start: 2_000, status: .accepted)]), now: now, rsvp: { _ in false }).isEmptyReceived == false)
    }

    @Test func declinedAndExpiredNeverCountOnTheBell() {
        let inbox = DIPInviteInbox(DIPInvites(received: [invite("a", start: -5), invite("b", start: 5, status: .declined)]), now: now)
        #expect(inbox.badgeCount == 0)
        #expect(inbox.isEmptyReceived)
    }

    @Test func sentIsNewestFirstWithExpiryLabels() {
        let sent = [invite("old", start: 100, status: .accepted, created: -300), invite("new", start: 100, created: -10),
                    invite("gone", start: -50, created: -100), invite("no", start: 100, status: .declined, created: -200)]
        let inbox = DIPInviteInbox(DIPInvites(sent: sent), now: now)
        #expect(inbox.sent.map(\.id) == ["new", "gone", "no", "old"])
        #expect(inbox.label(for: sent[0]) == .accepted)
        #expect(inbox.label(for: sent[1]) == .pending)
        #expect(inbox.label(for: sent[2]) == .expired)
        #expect(inbox.label(for: sent[3]) == .declined)
    }

    @Test func shortWhenTextIsDateOnly() {
        let text = DIPInviteInbox.shortWhenText(Date(timeIntervalSince1970: 1_800_000_000), locale: Locale(identifier: "en_US"), timeZone: TimeZone(identifier: "UTC")!)
        #expect(text == "Fri, Jan 15")
        #expect(!text.contains(":"))
    }

    @Test func whenTextIsOneLineWithDayAndTime() {
        let text = DIPInviteInbox.whenText(Date(timeIntervalSince1970: 1_800_000_000), locale: Locale(identifier: "en_US"), timeZone: TimeZone(identifier: "UTC")!)
        #expect(text.contains("Jan") && text.contains("15"))
        #expect(text.contains("8:00"))
    }
}

@Suite struct MockInvitesRepositoryTests {
    @Test func searchMatchesWordPrefixesAndAnnotatesState() async throws {
        let repo = DIPMockInvitesRepository.reference()
        let found = try await repo.searchCoworkers(eventID: "puppy-yoga", query: "pr")
        #expect(found.map(\.name) == ["Prisha Nair", "Priya Shah"])
        let state = Dictionary(uniqueKeysWithValues: try await repo.searchCoworkers(eventID: "puppy-yoga", query: "sam").map { ($0.name, $0.state) })
        #expect(state["Sam Okafor"] == .going)
        let mia = try await repo.searchCoworkers(eventID: "puppy-yoga", query: "mia")
        #expect(mia.first?.state == .invited)
        await #expect(throws: DIPInviteFailure.self) { _ = try await repo.searchCoworkers(eventID: "puppy-yoga", query: "p") }
    }

    @Test func sendIsIdempotentPerRequestAndRefusesDuplicatesAndGoingCoworkers() async throws {
        let repo = DIPMockInvitesRepository.reference()
        try await repo.send(eventID: "pasta-night", toUserID: "u-priya", message: "hi", requestID: "request-one")
        try await repo.send(eventID: "pasta-night", toUserID: "u-priya", message: "hi", requestID: "request-one")
        #expect(await repo.sendCount == 1)
        await #expect(throws: DIPInviteFailure.alreadyInvited) { try await repo.send(eventID: "pasta-night", toUserID: "u-priya", message: "", requestID: "request-two") }
        await #expect(throws: DIPInviteFailure.alreadyGoing) { try await repo.send(eventID: "puppy-yoga", toUserID: "u-sam", message: "", requestID: "request-three") }
        let sent = await repo.current().sent
        #expect(sent.filter { $0.personID == "u-priya" }.count == 1)
    }

    @Test func acceptingJoinsAndAFullEventKeepsTheInvitePending() async throws {
        let repo = DIPMockInvitesRepository.reference()
        let reply = try await repo.respond(inviteID: "e1_me", accept: true)
        #expect(reply == DIPInviteReply(status: .accepted, joined: true))
        #expect(try await repo.respond(inviteID: "e1_me", accept: true).joined)
        await repo.markFull("kayaking-sunrise")
        await #expect(throws: DIPInviteFailure.full) { _ = try await repo.respond(inviteID: "e2_me", accept: true) }
        #expect(await repo.current().received.first { $0.id == "e2_me" }?.status == .pending)
        let declined = try await repo.respond(inviteID: "e2_me", accept: false)
        #expect(declined == DIPInviteReply(status: .declined, joined: false))
    }

    @Test func observersReceiveEveryCommittedChange() async throws {
        let repo = DIPMockInvitesRepository.reference()
        var iterator = await repo.observe().makeAsyncIterator()
        let first = try await iterator.next()
        #expect(first?.received.count == 4)
        _ = try await repo.respond(inviteID: "e1_me", accept: false)
        let second = try await iterator.next()
        #expect(second?.received.first { $0.id == "e1_me" }?.status == .declined)
    }
}
