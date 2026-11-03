import DIPCore
import DIPMockData
import Foundation
import XCTest

@MainActor
final class SocialCommandTests: XCTestCase {
    func testMessagesHaveAttributionAndStableRetryIdentityAcrossObservers() async throws {
        let repository = DIPMockRepository(initiallyJoinedEventIDs: ["puppy-yoga", "kayaking"], initialFailures: [.message: "offline"])
        let streamA = await repository.observe(), streamB = await repository.observe()
        var first = streamA.makeAsyncIterator(), second = streamB.makeAsyncIterator()
        let initialValue = try await first.next()
        let initial = try XCTUnwrap(initialValue)
        _ = try await second.next()
        await expect(.injectedFailure("offline")) {
            try await repository.sendMessage(eventID: "puppy-yoga", messageID: "draft-1", text: "  See you there  ")
        }
        let afterFailure = await repository.currentSnapshot()
        XCTAssertEqual(afterFailure, initial)
        let beforeSend = Date()
        try await repository.sendMessage(eventID: "puppy-yoga", messageID: "draft-1", text: "  See you there  ")
        let updateA = try await first.next(), updateB = try await second.next()
        XCTAssertEqual(updateA, updateB)
        let confirmed = try XCTUnwrap(updateA)
        let message = try XCTUnwrap(confirmed.messages["puppy-yoga"]?.last)
        XCTAssertEqual(message.id, "draft-1")
        XCTAssertEqual(message.text, "See you there")
        XCTAssertEqual(message.authorID, confirmed.profile.id)
        XCTAssertEqual(message.authorName, "Elissa Woode")
        XCTAssertEqual(message.authorAvatar, confirmed.profile.avatar)
        XCTAssertGreaterThanOrEqual(message.createdAt, beforeSend)
        try await repository.sendMessage(eventID: "puppy-yoga", messageID: "draft-1", text: "See you there")
        let repeated = await repository.currentSnapshot()
        XCTAssertEqual(repeated, confirmed, "An acknowledged retry keeps the original timestamp and message")
        await expect(.invalidInput("Message identity already exists")) {
            try await repository.sendMessage(eventID: "puppy-yoga", messageID: "draft-1", text: "Changed payload")
        }
        let afterConflict = await repository.currentSnapshot()
        XCTAssertEqual(afterConflict, confirmed)
        try await repository.sendMessage(eventID: "kayaking", messageID: "draft-1", text: "Other event")
        let otherEvent = await repository.currentSnapshot()
        XCTAssertEqual(otherEvent.messages["puppy-yoga"]?.count, 2)
        XCTAssertEqual(otherEvent.messages["kayaking"]?.last?.text, "Other event")
        let reopenedStream = await repository.observe()
        var reopened = reopenedStream.makeAsyncIterator()
        let retained = try await reopened.next()
        XCTAssertEqual(retained, otherEvent)
    }

    func testCommentsPersistAndDoNotLeakAcrossPhotosOrEvents() async throws {
        let repository = DIPMockRepository(initialFailures: [.comment: "offline"])
        let streamA = await repository.observe(), streamB = await repository.observe()
        var first = streamA.makeAsyncIterator(), second = streamB.makeAsyncIterator()
        let initialValue = try await first.next()
        let initial = try XCTUnwrap(initialValue)
        _ = try await second.next()
        XCTAssertTrue(initial.photoComments.isEmpty)
        await expect(.injectedFailure("offline")) {
            try await repository.addPhotoComment(eventID: "kayaking-memory", photoID: "0", commentID: "comment-1", text: "  Great day!  ")
        }
        let afterFailure = await repository.currentSnapshot()
        XCTAssertEqual(afterFailure, initial)
        let beforeSend = Date()
        try await repository.addPhotoComment(eventID: "kayaking-memory", photoID: "0", commentID: "comment-1", text: "  Great day!  ")
        let updateA = try await first.next(), updateB = try await second.next()
        XCTAssertEqual(updateA, updateB)
        let confirmed = try XCTUnwrap(updateA)
        let comment = try XCTUnwrap(confirmed.photoComments["kayaking-memory"]?["0"]?.first)
        XCTAssertEqual(comment.id, "comment-1")
        XCTAssertEqual(comment.text, "Great day!")
        XCTAssertEqual(comment.authorID, confirmed.profile.id)
        XCTAssertEqual(comment.authorName, confirmed.profile.displayName)
        XCTAssertEqual(comment.authorAvatar, confirmed.profile.avatar)
        XCTAssertGreaterThanOrEqual(comment.createdAt, beforeSend)
        XCTAssertNil(confirmed.photoComments["kayaking-memory"]?["1"])
        XCTAssertNil(confirmed.photoComments["boat-ride"])
        try await repository.addPhotoComment(eventID: "kayaking-memory", photoID: "0", commentID: "comment-1", text: "Great day!")
        let repeated = await repository.currentSnapshot()
        XCTAssertEqual(repeated, confirmed)
        await expect(.invalidInput("Comment identity already exists")) {
            try await repository.addPhotoComment(eventID: "kayaking-memory", photoID: "0", commentID: "comment-1", text: "Changed payload")
        }
        let afterConflict = await repository.currentSnapshot()
        XCTAssertEqual(afterConflict, confirmed)
        try await repository.addPhotoComment(eventID: "kayaking-memory", photoID: "1", commentID: "comment-1", text: "Other photo")
        try await repository.addPhotoComment(eventID: "boat-ride", photoID: "0", commentID: "comment-1", text: "Other event")
        let isolated = await repository.currentSnapshot()
        XCTAssertEqual(isolated.photoComments["kayaking-memory"]?["0"]?.count, 1)
        XCTAssertEqual(isolated.photoComments["kayaking-memory"]?["1"]?.first?.text, "Other photo")
        XCTAssertEqual(isolated.photoComments["boat-ride"]?["0"]?.first?.text, "Other event")
        let reopenedStream = await repository.observe()
        var reopened = reopenedStream.makeAsyncIterator()
        let retained = try await reopened.next()
        XCTAssertEqual(retained?.photoComments, isolated.photoComments)
    }

    func testSocialValidationRejectsInvalidParentsIdentitiesAndTextWithoutMutation() async throws {
        let repository = DIPMockRepository(initiallyJoinedEventIDs: ["puppy-yoga"])
        let initial = await repository.currentSnapshot()
        await expect(.notFound("missing")) {
            try await repository.sendMessage(eventID: "missing", messageID: "message", text: "Hello")
        }
        await expect(.notFound("missing")) {
            try await repository.addPhotoComment(eventID: "missing", photoID: "0", commentID: "comment", text: "Hello")
        }
        await expect(.notFound("missing-photo")) {
            try await repository.addPhotoComment(eventID: "kayaking-memory", photoID: "missing-photo", commentID: "comment", text: "Hello")
        }
        await expect(.invalidInput("Message identity is required")) {
            try await repository.sendMessage(eventID: "puppy-yoga", messageID: " ", text: "Hello")
        }
        await expect(.invalidInput("Comment identity is required")) {
            try await repository.addPhotoComment(eventID: "kayaking-memory", photoID: "0", commentID: "", text: "Hello")
        }
        await expect(.invalidInput("Message is empty")) {
            try await repository.sendMessage(eventID: "puppy-yoga", messageID: "message", text: "\n ")
        }
        await expect(.invalidInput("Comment is empty")) {
            try await repository.addPhotoComment(eventID: "kayaking-memory", photoID: "0", commentID: "comment", text: "\n ")
        }
        let longText = String(repeating: "x", count: 2_001)
        await expect(.invalidInput("Message exceeds 2000 characters")) {
            try await repository.sendMessage(eventID: "puppy-yoga", messageID: "message", text: longText)
        }
        await expect(.invalidInput("Comment exceeds 2000 characters")) {
            try await repository.addPhotoComment(eventID: "kayaking-memory", photoID: "0", commentID: "comment", text: longText)
        }
        let unchanged = await repository.currentSnapshot()
        XCTAssertEqual(unchanged, initial)
        let maximumText = String(repeating: "x", count: 2_000)
        try await repository.sendMessage(eventID: "puppy-yoga", messageID: "maximum-message", text: maximumText)
        try await repository.addPhotoComment(eventID: "kayaking-memory", photoID: "0", commentID: "maximum-comment", text: maximumText)
        let boundary = await repository.currentSnapshot()
        XCTAssertEqual(boundary.messages["puppy-yoga"]?.last?.text.count, 2_000)
        XCTAssertEqual(boundary.photoComments["kayaking-memory"]?["0"]?.last?.text.count, 2_000)
    }

    func testMessagesRequireObservedParticipationAndImportsKeepAttribution() async throws {
        let repository = DIPMockRepository()
        await expect(.invalidInput("Join this activity before sending a message")) {
            try await repository.sendMessage(eventID: "puppy-yoga", messageID: "not-joined", text: "Hello")
        }
        try await repository.setRSVP(eventID: "puppy-yoga", going: true)
        try await repository.sendMessage(eventID: "puppy-yoga", messageID: "joined", text: "Hello")
        try await repository.setRSVP(eventID: "puppy-yoga", going: false)
        await expect(.invalidInput("Join this activity before sending a message")) {
            try await repository.sendMessage(eventID: "puppy-yoga", messageID: "left", text: "Hello")
        }
        try await repository.addPhotos(eventID: "kayaking-memory", photos: [.init(id: "import", data: Data([1]))])
        let snapshot = await repository.currentSnapshot()
        XCTAssertEqual(snapshot.albums["kayaking-memory"]?.photos.last?.attribution,
                       .init(name: snapshot.profile.displayName, avatar: snapshot.profile.avatar))
    }

    private func expect(_ expected: DIPRepositoryError, _ operation: () async throws -> Void) async {
        do { try await operation(); XCTFail("Expected \(expected)") }
        catch { XCTAssertEqual(error as? DIPRepositoryError, expected) }
    }
}
