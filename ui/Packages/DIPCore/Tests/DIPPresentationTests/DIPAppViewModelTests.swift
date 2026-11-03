import DIPCore
import DIPMockData
import DIPPresentation
import Foundation
import Testing

/// Independent adapter: acknowledgements and listener snapshots are deliberately separated.
private actor ControlledRepository: DIPRepository {
    private var continuation: AsyncThrowingStream<DIPAppSnapshot, Error>.Continuation?
    private var shouldFail = false
    private(set) var rsvpCalls = 0
    private(set) var messageIDs: [String] = []
    private(set) var commentIDs: [String] = []
    func observe() async -> AsyncThrowingStream<DIPAppSnapshot, Error> {
        let pair = AsyncThrowingStream<DIPAppSnapshot, Error>.makeStream()
        continuation = pair.continuation
        pair.continuation.yield(DIPMockFixtures.reference)
        return pair.stream
    }
    func emit(_ snapshot: DIPAppSnapshot) { continuation?.yield(snapshot) }
    func failStream() { continuation?.finish(throwing: DIPRepositoryError.injectedFailure("offline")) }
    func failNextCommand() { shouldFail = true }
    func setRSVP(eventID: String, going: Bool) async throws {
        rsvpCalls += 1
        if shouldFail { shouldFail = false; throw DIPRepositoryError.injectedFailure("offline") }
    }
    func updateProfile(_ edit: ProfileEdit) async throws {}
    func sendMessage(eventID: String, messageID: String, text: String) async throws {
        messageIDs.append(messageID)
        if shouldFail { shouldFail = false; throw DIPRepositoryError.injectedFailure("offline") }
    }
    func addPhotoComment(eventID: String, photoID: String, commentID: String, text: String) async throws {
        commentIDs.append(commentID)
        if shouldFail { shouldFail = false; throw DIPRepositoryError.injectedFailure("offline") }
    }
    func addPhotos(eventID: String, photos: [PhotoUpload]) async throws {}
}

@MainActor
private func eventually(_ condition: () -> Bool) async -> Bool {
    for _ in 0..<200 {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return condition()
}

@MainActor
struct DIPAppViewModelTests {
    @Test func commandAcknowledgementDoesNotInventJoinedState() async throws {
        let adapter = ControlledRepository()
        let model = DIPAppViewModel(repository: adapter)
        let observation = Task { await model.observe() }
        defer { observation.cancel() }
        #expect(await eventually { model.snapshot != nil })
        try await model.setRSVP(eventID: "puppy-yoga", going: true)
        #expect(model.snapshot?.eventDetails["puppy-yoga"]?.isJoined == false)
        var confirmed = DIPMockFixtures.reference
        confirmed.eventDetails["puppy-yoga"]?.isJoined = true
        confirmed.eventDetails["puppy-yoga"]?.attendeeCount = 17
        await adapter.emit(confirmed)
        #expect(await eventually { model.snapshot?.eventDetails["puppy-yoga"]?.isJoined == true })
        #expect(model.snapshot?.eventDetails["puppy-yoga"]?.attendeeCount == 17)
    }

    @Test func failedCommandRetainsSnapshotAndAllowsRetry() async throws {
        let adapter = ControlledRepository()
        let model = DIPAppViewModel(repository: adapter)
        let observation = Task { await model.observe() }
        defer { observation.cancel() }
        #expect(await eventually { model.snapshot != nil })
        await adapter.failNextCommand()
        do {
            try await model.setRSVP(eventID: "puppy-yoga", going: true)
            Issue.record("Expected the adapter failure to propagate")
        } catch {}
        #expect(model.commandError != nil)
        #expect(model.pendingCommands.isEmpty)
        #expect(model.snapshot == DIPMockFixtures.reference)
        try await model.setRSVP(eventID: "puppy-yoga", going: true)
        #expect(model.commandError == nil)
        #expect(await adapter.rsvpCalls == 2)
    }

    @Test func disconnectedStreamPreservesLastSnapshotAndReconnects() async {
        let adapter = ControlledRepository()
        let model = DIPAppViewModel(repository: adapter)
        let first = Task { await model.observe() }
        #expect(await eventually { model.snapshot != nil })
        await adapter.failStream()
        await first.value
        #expect(model.loadError != nil)
        #expect(!model.isLoading)
        #expect(model.snapshot == DIPMockFixtures.reference)
        let retry = Task { await model.observe() }
        defer { retry.cancel() }
        #expect(await eventually { model.loadError == nil })
    }

    @Test func socialAcknowledgementsWaitForObservedState() async throws {
        let adapter = ControlledRepository()
        let model = DIPAppViewModel(repository: adapter)
        let observation = Task { await model.observe() }
        defer { observation.cancel() }
        #expect(await eventually { model.snapshot != nil })
        try await model.sendMessage(eventID: "puppy-yoga", messageID: "draft-1", text: "Hello")
        try await model.addPhotoComment(eventID: "kayaking-memory", photoID: "0", commentID: "comment-1", text: "Great day")
        #expect(model.snapshot?.messages["puppy-yoga"]?.count == 1)
        #expect(model.snapshot?.photoComments.isEmpty == true)
        var confirmed = DIPMockFixtures.reference
        confirmed.messages["puppy-yoga", default: []].append(.init(id: "draft-1", authorID: confirmed.profile.id, text: "Hello", authorName: confirmed.profile.displayName, authorAvatar: confirmed.profile.avatar, createdAt: Date()))
        confirmed.photoComments["kayaking-memory", default: [:]]["0"] = [.init(id: "comment-1", authorID: confirmed.profile.id, authorName: confirmed.profile.displayName, authorAvatar: confirmed.profile.avatar, text: "Great day", createdAt: Date())]
        await adapter.emit(confirmed)
        #expect(await eventually { model.snapshot?.messages["puppy-yoga"]?.count == 2 })
        #expect(model.snapshot?.photoComments["kayaking-memory"]?["0"]?.first?.text == "Great day")
        #expect(await adapter.messageIDs == ["draft-1"])
        #expect(await adapter.commentIDs == ["comment-1"])
    }

    @Test func socialFailuresPreserveSnapshotAndForwardSameIdentityOnRetry() async throws {
        let adapter = ControlledRepository()
        let model = DIPAppViewModel(repository: adapter)
        let observation = Task { await model.observe() }
        defer { observation.cancel() }
        #expect(await eventually { model.snapshot != nil })
        await adapter.failNextCommand()
        do {
            try await model.sendMessage(eventID: "puppy-yoga", messageID: "draft-1", text: "Hello")
            Issue.record("Expected message failure")
        } catch {}
        #expect(model.commandError != nil)
        #expect(model.pendingCommands.isEmpty)
        #expect(model.snapshot == DIPMockFixtures.reference)
        try await model.sendMessage(eventID: "puppy-yoga", messageID: "draft-1", text: "Hello")
        #expect(model.commandError == nil)
        #expect(await adapter.messageIDs == ["draft-1", "draft-1"])
        await adapter.failNextCommand()
        do {
            try await model.addPhotoComment(eventID: "kayaking-memory", photoID: "0", commentID: "comment-1", text: "Great day")
            Issue.record("Expected comment failure")
        } catch {}
        #expect(model.commandError != nil)
        #expect(model.pendingCommands.isEmpty)
        #expect(model.snapshot == DIPMockFixtures.reference)
        try await model.addPhotoComment(eventID: "kayaking-memory", photoID: "0", commentID: "comment-1", text: "Great day")
        #expect(model.commandError == nil)
        #expect(await adapter.commentIDs == ["comment-1", "comment-1"])
    }

}
