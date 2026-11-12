import DIPCore
import DIPMockData
import DIPPresentation
import Foundation
import Testing

/// A repository whose send fails a controlled number of times, recording every request id it saw.
private actor FlakyInvites: DIPInvitesRepository {
    private(set) var requestIDs: [String] = []
    private var failures: [DIPInviteFailure]
    init(failures: [DIPInviteFailure] = []) { self.failures = failures }
    func observe() async -> AsyncThrowingStream<DIPInvites, Error> {
        AsyncThrowingStream { $0.yield(DIPInvites()); $0.finish() }
    }
    func searchCoworkers(eventID: String, query: String) async throws -> [DIPCoworker] {
        [DIPCoworker(id: "u-1", name: "Priya Shah", team: "Design"), DIPCoworker(id: "u-2", name: "Prisha Nair", state: .going)]
    }
    func send(eventID: String, toUserID: String, message: String, requestID: String) async throws {
        requestIDs.append(requestID)
        if !failures.isEmpty { throw failures.removeFirst() }
    }
    func respond(inviteID: String, accept: Bool) async throws -> DIPInviteReply { DIPInviteReply(status: accept ? .accepted : .declined, joined: accept) }
}

@MainActor @Suite struct DIPInvitesModelTests {
    @Test func observeLoadsThenBadgeCountsPendingInvites() async {
        let model = DIPInvitesModel(repository: DIPMockInvitesRepository.reference())
        #expect(model.phase == .loading)
        let task = Task { await model.observe() }
        for _ in 0..<50 where model.phase == .loading { try? await Task.sleep(for: .milliseconds(10)) }
        task.cancel()
        #expect(model.phase == .ready)
        #expect(model.badgeCount == 2)
        #expect(model.inbox.sent.count == 3)
    }

    @Test func aFailedFirstLoadIsAFailureAndALostListenerKeepsTheLastState() async {
        let failing = DIPInvitesModel(repository: DIPMockInvitesRepository.empty(behavior: .init(observeFailure: true)))
        await failing.observe()
        #expect(failing.phase == .failed(DIPInviteFailure.offline.message))
        #expect(!failing.isStale)

        let model = DIPInvitesModel(repository: FlakyInvites())
        await model.observe()
        #expect(model.phase == .ready)
        #expect(model.isStale)   // the stream ended after data: last good state stays, flagged offline
    }

    @Test func acceptingUpdatesTheRowAndRemembersTheJoin() async {
        let model = DIPInvitesModel(repository: DIPMockInvitesRepository.reference())
        let task = Task { await model.observe() }
        for _ in 0..<50 where model.invites == nil { try? await Task.sleep(for: .milliseconds(10)) }
        let reply = await model.respond(inviteID: "e1_me", accept: true)
        task.cancel()
        #expect(reply?.joined == true)
        #expect(model.joinedInviteIDs.contains("e1_me"))
        #expect(model.invites?.received.first { $0.id == "e1_me" }?.status == .accepted)
        #expect(model.badgeCount == 1)
        #expect(model.answerErrors.isEmpty)
    }

    @Test func acceptedInvitesFollowTheLiveRSVPAndRejoinGoesThroughTheJoinCommand() async {
        var now = Date()
        let model = DIPInvitesModel(repository: DIPMockInvitesRepository.reference(now: now), now: { now })
        let task = Task { await model.observe() }
        for _ in 0..<50 where model.invites == nil { try? await Task.sleep(for: .milliseconds(10)) }
        task.cancel()
        // e4_me (Kayaking) was accepted earlier; the member has since left: Cancelled, with a Rejoin.
        let left: (String) -> Bool? = { $0 == "kayaking" ? false : nil }
        #expect(model.inbox(rsvp: left).cancelled.map(\.id) == ["e4_me"])
        let invite = model.inbox(rsvp: left).cancelled[0]
        var asked: [String] = []
        #expect(await model.rejoin(invite, perform: { asked.append($0); return .full }) == false)
        #expect(model.rejoinErrors["e4_me"] == .full)
        #expect(await model.rejoin(invite, perform: { asked.append($0); return nil }))
        #expect(asked == ["kayaking", "kayaking"])
        #expect(model.rejoinErrors["e4_me"] == nil)
        // Just rejoined: counts as going while the RSVP listener catches up, then the live state rules again.
        #expect(model.inbox(rsvp: left).cancelled.isEmpty)
        now = now.addingTimeInterval(DIPInvitesModel.acceptanceGrace + 1)
        #expect(model.inbox(rsvp: left).cancelled.map(\.id) == ["e4_me"])
        #expect(model.inbox(rsvp: { _ in true }).cancelled.isEmpty)
    }

    @Test func aJustAcceptedInviteNeverFlashesAsCancelledAndReportsTheJoin() async {
        var joined: [String] = []
        let model = DIPInvitesModel(repository: DIPMockInvitesRepository.reference())
        model.didJoin = { joined.append($0) }
        let task = Task { await model.observe() }
        for _ in 0..<50 where model.invites == nil { try? await Task.sleep(for: .milliseconds(10)) }
        task.cancel()
        _ = await model.respond(inviteID: "e1_me", accept: true)
        #expect(joined == ["puppy-yoga"])
        // The RSVP listener has not caught up yet (not going): still shown as Going, not Cancelled.
        let inbox = model.inbox(rsvp: { _ in false })
        #expect(inbox.accepted.contains { $0.id == "e1_me" })
        #expect(!inbox.cancelled.contains { $0.id == "e1_me" })
    }

    @Test func aFullEventLeavesTheInvitePendingWithAnActionableError() async {
        let repository = DIPMockInvitesRepository.reference(behavior: .init(respondFailure: .full))
        let model = DIPInvitesModel(repository: repository)
        let task = Task { await model.observe() }
        for _ in 0..<50 where model.invites == nil { try? await Task.sleep(for: .milliseconds(10)) }
        let reply = await model.respond(inviteID: "e1_me", accept: true)
        task.cancel()
        #expect(reply == nil)
        #expect(model.answerErrors["e1_me"] == .full)
        #expect(model.invites?.received.first { $0.id == "e1_me" }?.status == .pending)
        model.clearAnswerError("e1_me")
        #expect(model.answerErrors.isEmpty)
    }
}

@MainActor @Suite struct DIPInvitePickerModelTests {
    private func picker(_ repository: any DIPInvitesRepository) -> DIPInvitePickerModel {
        DIPInvitePickerModel(eventID: "pasta-night", repository: repository, debounce: .milliseconds(1))
    }

    @Test func shortQueriesNeverSearchAndSayWhy() async {
        let model = picker(DIPMockInvitesRepository.reference())
        model.query = "p"
        await model.queryChanged()
        #expect(model.phase == .idle)
        #expect(model.queryTooShort)
        model.query = ""
        #expect(!model.queryTooShort)
    }

    @Test func searchShowsResultsEmptyAndFailureStates() async {
        let model = picker(DIPMockInvitesRepository.reference())
        model.query = "pr"
        await model.queryChanged()
        #expect(model.phase == .results)
        #expect(model.coworkers.map(\.name) == ["Prisha Nair", "Priya Shah"])
        model.query = "zzz"
        await model.queryChanged()
        #expect(model.phase == .empty)
        let broken = picker(DIPMockInvitesRepository.reference(behavior: .init(searchFailure: .offline)))
        broken.query = "pr"
        await broken.search()
        #expect(broken.phase == .failed(.offline))
    }

    @Test func sendingMarksInvitedOnceAndRefusesASecondTap() async {
        let repository = DIPMockInvitesRepository.reference()
        let model = picker(repository)
        model.query = "priya"; model.note = "  Join us  "
        await model.search()
        let priya = model.coworkers[0]
        #expect(await model.send(priya))
        #expect(model.state(of: priya) == .invited)
        #expect(!(await model.send(priya)))
        #expect(await repository.sendCount == 1)
        #expect(await repository.current().sent.first { $0.personID == "u-priya" }?.message == "Join us")
    }

    @Test func aRetryAfterATransientFailureReusesTheRequestIDButARefusalStartsFresh() async {
        let flaky = FlakyInvites(failures: [.offline, .full])
        let model = picker(flaky)
        model.query = "pr"
        await model.search()
        let priya = model.coworkers[0]
        #expect(!(await model.send(priya)))
        #expect(model.rowErrors[priya.id] == .offline)
        #expect(!(await model.send(priya)))
        #expect(model.rowErrors[priya.id] == .full)
        #expect(await model.send(priya))
        let ids = await flaky.requestIDs
        #expect(ids.count == 3)
        #expect(ids[0] == ids[1])        // transient failure: same request id, so the server can dedupe
        #expect(ids[1] != ids[2])        // definite refusal: the next attempt is a new request
        #expect(model.rowErrors[priya.id] == nil)
    }

    @Test func alreadyInvitedAndAlreadyGoingBecomeRowStates() async {
        // (alreadyInvitedIDs marks rows another coworker invited)
        let flaky = FlakyInvites(failures: [.alreadyInvited])
        let model = picker(flaky)
        model.query = "pr"
        await model.search()
        _ = await model.send(model.coworkers[0])
        #expect(model.state(of: model.coworkers[0]) == .invited)
        #expect(model.alreadyInvitedIDs.contains(model.coworkers[0].id))
        #expect(model.state(of: model.coworkers[1]) == .going)
        #expect(!(await model.send(model.coworkers[1])))
        #expect(await flaky.requestIDs.count == 1)
    }
}
