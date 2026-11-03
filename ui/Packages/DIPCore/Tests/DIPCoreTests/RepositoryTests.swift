import DIPCore
import DIPMockData
import Foundation
import XCTest

@MainActor
final class RepositoryTests: XCTestCase {
    func testPastEventsProvideConsistentDetailsAndRejectRSVP() async throws {
        let fixture = DIPMockFixtures.reference
        for memory in fixture.memories {
            let event = try XCTUnwrap(fixture.eventDetails[memory.eventID])
            XCTAssertTrue(event.isPast)
            XCTAssertEqual(fixture.participants[event.id]?.count, event.attendeeCount)
            XCTAssertNotNil(fixture.albums[event.id])
        }
        let repository = DIPMockRepository()
        do {
            try await repository.setRSVP(eventID: "kayaking-memory", going: true)
            XCTFail("Past event must not accept an RSVP")
        } catch { XCTAssertEqual(error as? DIPRepositoryError, .invalidInput("This activity has ended")) }
    }

    func testInterestsUseCatalogLimitAndPreserveOtherProfileFields() async throws {
        let repository = DIPMockRepository()
        let initial = await repository.currentSnapshot()
        let profile = initial.profile
        let eleven = Array(profile.interestCatalog.map(\.id).prefix(11))
        await expect(.invalidInput("Choose up to 10 interests")) {
            try await repository.updateProfile(.init(department: profile.department, city: profile.city, interestTagIDs: eleven))
        }
        let unchanged = await repository.currentSnapshot()
        XCTAssertEqual(unchanged, initial)
        try await repository.updateProfile(.init(department: profile.department, city: profile.city,
            interestTagIDs: Array(profile.interestCatalog.map(\.id).prefix(10))))
        let saved = await repository.currentSnapshot()
        XCTAssertEqual(saved.profile.interests.count, 10)
        XCTAssertEqual(saved.profile.department, profile.department)
        XCTAssertEqual(saved.profile.city, profile.city)
        XCTAssertEqual(saved.profile.displayName, profile.displayName)
        try await repository.updateProfile(.init(department: profile.department, city: profile.city, interestTagIDs: []))
        let cleared = await repository.currentSnapshot()
        XCTAssertTrue(cleared.profile.interests.isEmpty)
    }

    func testInterestRenamesKeepIDsAndMissingSelectionsAreNotSilentlyLost() async throws {
        var seed = DIPMockFixtures.reference
        let index = try XCTUnwrap(seed.profile.interestCatalog.firstIndex { $0.id == "tag-fitness" })
        seed.profile.interestCatalog[index].name = "Movement"
        seed.profile.interestTagIDs.append("tag-retired")
        let repository = DIPMockRepository(initialSnapshot: seed)
        try await repository.updateProfile(.init(department: seed.profile.department, city: seed.profile.city,
            interestTagIDs: ["tag-fitness", "tag-retired"]))
        let saved = await repository.currentSnapshot()
        XCTAssertEqual(saved.profile.interestTagIDs, ["tag-fitness", "tag-retired"])
        XCTAssertEqual(saved.profile.interests, ["Movement", "Unavailable interest"])
        await expect(.invalidInput("Unknown interest")) {
            try await repository.updateProfile(.init(department: "", city: "", interestTagIDs: ["Movement"]))
        }
    }

    func testReferenceSnapshotPreservesExistingPrototype() async throws {
        let repository = DIPMockRepository()
        let stream = await repository.observe()
        var iterator = stream.makeAsyncIterator()
        let snapshotValue = try await iterator.next()
        let snapshot = try XCTUnwrap(snapshotValue)
        XCTAssertEqual(snapshot.home.unreadCount, 5)
        XCTAssertEqual(snapshot.home.events.map(\.attendeeCount), [7, 13, 10])
        XCTAssertEqual(snapshot.home.events.map(\.image), [.asset("EventCard"), .asset("EventCard1"), .asset("EventCard2")])
        XCTAssertEqual(snapshot.home.recentAttendeeAvatars, (3...7).map { .asset("CoworkerProfilePicture\($0)") })
        XCTAssertEqual(snapshot.home.challenge?.participantCount, 128)
        XCTAssertEqual(snapshot.home.challenge?.artwork, .asset("Mascot"))
        XCTAssertEqual(snapshot.activeEvents.map(\.id), ["puppy-yoga", "game-cafe", "mount-diablo-hike", "cooking-class"])
        XCTAssertEqual(snapshot.memories.count, 8)
        XCTAssertEqual(snapshot.memories[3].id, "boat-ride")
        XCTAssertEqual(snapshot.memories[3].image, .asset("events-past_EventCard3"))
        XCTAssertEqual(snapshot.profile.displayName, "Elissa Woode")
        XCTAssertEqual(snapshot.profile.interests, ["Fitness", "Cooking", "Outdoors", "Carpentry"])
        XCTAssertEqual(snapshot.profile.favoriteMemories.map(\.dateLabel), ["03/01", "02/10", "02/07", "02/04", "01/07", "12/30"])
        XCTAssertEqual(snapshot.eventDetails["puppy-yoga"]?.attendeeCount, 16)
        XCTAssertEqual(snapshot.eventDetails["puppy-yoga"]?.attendeeOverflowCount, 12)
        XCTAssertEqual(snapshot.participants["puppy-yoga"]?.count, 17)
        XCTAssertEqual(snapshot.participants["puppy-yoga"]?.first?.name, "Elissa Woode")
        XCTAssertEqual(snapshot.participants["puppy-yoga"]?.last?.name, "Liam Harris")
        let album = try XCTUnwrap(snapshot.albums["kayaking-memory"])
        XCTAssertEqual(album.photos.map(\.image), ["Rectangle931", "Rectangle933", "Rectangle934", "Rectangle932", "Rectangle935", "Rectangle936", "Rectangle937", "Rectangle938", "Rectangle939", "Rectangle940", "Rectangle935", "Rectangle941"].map { .asset("album_" + $0) })
        XCTAssertEqual(album.photos[0].attribution?.name, "Jane Gertskey")
        XCTAssertEqual(album.photos[8].attribution?.name, "Alexis Standall")
        for memory in snapshot.memories {
            XCTAssertEqual(snapshot.albums[memory.eventID]?.photos.count, 12)
            XCTAssertEqual(snapshot.participants[memory.eventID]?.count, 13)
            XCTAssertEqual(snapshot.messages[memory.eventID]?.first?.text, "Looking forward to this activity!")
        }
    }

    func testRSVPIsIdempotentAcrossConcurrentCommandsAndObservers() async throws {
        let repository = DIPMockRepository()
        let firstStream = await repository.observe()
        let secondStream = await repository.observe()
        var first = firstStream.makeAsyncIterator()
        var second = secondStream.makeAsyncIterator()
        _ = try await first.next()
        _ = try await second.next()
        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<20 { group.addTask { try await repository.setRSVP(eventID: "puppy-yoga", going: true) } }
            try await group.waitForAll()
        }
        let fromFirst = try await first.next()
        let fromSecond = try await second.next()
        XCTAssertEqual(fromFirst, fromSecond)
        let joined = try XCTUnwrap(fromFirst)
        XCTAssertEqual(joined.eventDetails["puppy-yoga"]?.isJoined, true)
        XCTAssertEqual(joined.eventDetails["puppy-yoga"]?.attendeeCount, 17)
        XCTAssertEqual(joined.eventDetails["puppy-yoga"]?.attendeeOverflowCount, 13)
        XCTAssertEqual(joined.eventDetails["puppy-yoga"]?.attendeeAvatars.first, .asset("event-joined_CoworkerProfilePicture"))
        XCTAssertEqual(joined.home.events[0].attendeeCount, 8)
        XCTAssertEqual(joined.activeEvents.filter { $0.id == "puppy-yoga" }.count, 1)
        XCTAssertEqual(joined.participants["puppy-yoga"]?.filter { $0.id == joined.profile.id }.count, 1)
        try await repository.setRSVP(eventID: "puppy-yoga", going: false)
        try await repository.setRSVP(eventID: "puppy-yoga", going: false)
        let cancelled = await repository.currentSnapshot()
        XCTAssertEqual(cancelled.eventDetails["puppy-yoga"]?.attendeeCount, 16)
        XCTAssertEqual(cancelled.eventDetails["puppy-yoga"]?.attendeeAvatars.first, .asset("event_CoworkerProfilePicture"))
        XCTAssertEqual(cancelled.home.events[0].attendeeCount, 7)
        XCTAssertFalse(cancelled.activeEvents.contains { $0.id == "puppy-yoga" })
        XCTAssertFalse(cancelled.participants["puppy-yoga", default: []].contains { $0.id == cancelled.profile.id })
    }

    func testProfileMessageAndPhotoCommandsPublishOneSharedState() async throws {
        let repository = DIPMockRepository(initiallyJoinedEventIDs: ["puppy-yoga"])
        let stream = await repository.observe()
        var iterator = stream.makeAsyncIterator()
        _ = try await iterator.next()
        try await repository.updateProfile(.init(department: " Design ", city: " New York ", interestTagIDs: ["tag-outdoors", "tag-fitness", "tag-fitness"]))
        let profileUpdateValue = try await iterator.next()
        let profileUpdate = try XCTUnwrap(profileUpdateValue)
        XCTAssertEqual(profileUpdate.profile.displayName, "Elissa Woode", "OAuth identity is read-only")
        XCTAssertEqual(profileUpdate.profile.department, "Design")
        XCTAssertEqual(profileUpdate.profile.city, "New York")
        XCTAssertEqual(profileUpdate.profile.interests, ["Fitness", "Outdoors"])
        XCTAssertEqual(profileUpdate.participants["puppy-yoga"]?.first?.name, "Elissa Woode")
        XCTAssertEqual(profileUpdate.participants["puppy-yoga"]?.first?.department, "Design")
        try await repository.sendMessage(eventID: "puppy-yoga", messageID: "test-message", text: "  Hello coworkers  ")
        let messageUpdateValue = try await iterator.next()
        let messageUpdate = try XCTUnwrap(messageUpdateValue)
        XCTAssertEqual(messageUpdate.messages["puppy-yoga"]?.last?.text, "Hello coworkers")
        XCTAssertEqual(messageUpdate.messages["puppy-yoga"]?.last?.authorID, profileUpdate.profile.id)
        let upload = PhotoUpload(id: "picked-photo", data: Data([1, 2, 3]))
        try await repository.addPhotos(eventID: "kayaking-memory", photos: [upload])
        let photoUpdateValue = try await iterator.next()
        let photoUpdate = try XCTUnwrap(photoUpdateValue)
        XCTAssertEqual(photoUpdate.albums["kayaking-memory"]?.photos.count, 13)
        XCTAssertEqual(photoUpdate.albums["kayaking-memory"]?.photos.last?.image, .data(upload.data))
        XCTAssertEqual(photoUpdate.albums["kayaking-memory"]?.photos.last?.isImported, true)
        try await repository.addPhotos(eventID: "kayaking-memory", photos: [upload])
        let repeated = await repository.currentSnapshot()
        XCTAssertEqual(repeated, photoUpdate)
        XCTAssertEqual(repeated.albums["boat-ride"]?.photos.count, 12, "Uploads belong to their event, not every reused reference album")
    }

    func testInjectedFailuresPreserveStateAndRetryWorks() async throws {
        let repository = DIPMockRepository()
        let initial = await repository.currentSnapshot()
        await repository.failNext(.rsvp, message: "offline")
        await expect(.injectedFailure("offline")) { try await repository.setRSVP(eventID: "puppy-yoga", going: true) }
        let afterRSVPFailure = await repository.currentSnapshot()
        XCTAssertEqual(afterRSVPFailure, initial)
        try await repository.setRSVP(eventID: "puppy-yoga", going: true)
        let joined = await repository.currentSnapshot()
        XCTAssertEqual(joined.eventDetails["puppy-yoga"]?.isJoined, true)
        await repository.failNext(.profile)
        await expect(.injectedFailure("Injected failure")) { try await repository.updateProfile(.init(department: "D", city: "C", interestTagIDs: [])) }
        let afterProfileFailure = await repository.currentSnapshot()
        XCTAssertEqual(afterProfileFailure, joined)
        await repository.failNext(.message)
        await expect(.injectedFailure("Injected failure")) { try await repository.sendMessage(eventID: "puppy-yoga", messageID: "test-message", text: "Hello") }
        await repository.failNext(.photos)
        await expect(.injectedFailure("Injected failure")) { try await repository.addPhotos(eventID: "kayaking-memory", photos: [.init(data: Data([1]))]) }
        let afterOtherFailures = await repository.currentSnapshot()
        XCTAssertEqual(afterOtherFailures, joined)
        try await repository.sendMessage(eventID: "puppy-yoga", messageID: "test-message", text: "Hello")
        try await repository.addPhotos(eventID: "kayaking-memory", photos: [.init(data: Data([1]))])
        let retried = await repository.currentSnapshot()
        XCTAssertEqual(retried.messages["puppy-yoga"]?.count, 2)
        XCTAssertEqual(retried.albums["kayaking-memory"]?.photos.count, 13)
    }

    func testValidationRejectsUnknownEventsAndAtomicInvalidPhotoBatch() async throws {
        let repository = DIPMockRepository(initiallyJoinedEventIDs: ["puppy-yoga"])
        let initial = await repository.currentSnapshot()
        await expect(.notFound("missing")) { try await repository.setRSVP(eventID: "missing", going: true) }
        await expect(.notFound("missing")) { try await repository.sendMessage(eventID: "missing", messageID: "test-message", text: "Hello") }
        await expect(.invalidInput("Unknown interest")) { try await repository.updateProfile(.init(department: "D", city: "C", interestTagIDs: ["Unknown"])) }
        await expect(.invalidInput("Message is empty")) { try await repository.sendMessage(eventID: "puppy-yoga", messageID: "test-message", text: " \n ") }
        await expect(.invalidInput("Choose a nonempty image smaller than 25 MB")) {
            try await repository.addPhotos(eventID: "kayaking-memory", photos: [.init(id: "valid", data: Data([1])), .init(id: "invalid", data: Data())])
        }
        let after = await repository.currentSnapshot()
        XCTAssertEqual(after, initial)
    }

    func testObservationErrorsCanBeRetriedAndExternalUpdatesAreObserved() async throws {
        let repository = DIPMockRepository()
        await repository.failNext(.observation, message: "first-listener")
        let failedStream = await repository.observe()
        var failed = failedStream.makeAsyncIterator()
        do {
            _ = try await failed.next()
            XCTFail("Expected initial observation failure")
        } catch {
            XCTAssertEqual(error as? DIPRepositoryError, .injectedFailure("first-listener"))
        }
        let stream = await repository.observe()
        var iterator = stream.makeAsyncIterator()
        let changedValue = try await iterator.next()
        var changed = try XCTUnwrap(changedValue)
        changed.home.unreadCount = 21
        await repository.replaceSnapshot(changed)
        let externalUpdate = try await iterator.next()
        XCTAssertEqual(externalUpdate?.home.unreadCount, 21)
        await repository.failObservation(message: "listener-ended")
        do {
            _ = try await iterator.next()
            XCTFail("Expected active observation failure")
        } catch {
            XCTAssertEqual(error as? DIPRepositoryError, .injectedFailure("listener-ended"))
        }
        let retryStream = await repository.observe()
        var retry = retryStream.makeAsyncIterator()
        let retried = try await retry.next()
        XCTAssertEqual(retried, changed)
    }

    func testJoinedLaunchStateUsesSameMutationRules() async throws {
        let repository = DIPMockRepository(initiallyJoinedEventIDs: ["puppy-yoga"])
        let snapshot = await repository.currentSnapshot()
        XCTAssertEqual(snapshot.eventDetails["puppy-yoga"]?.isJoined, true)
        XCTAssertEqual(snapshot.eventDetails["puppy-yoga"]?.attendeeCount, 17)
        XCTAssertEqual(snapshot.home.events[0].attendeeCount, 8)
    }

    private func expect(_ expected: DIPRepositoryError, _ operation: () async throws -> Void) async {
        do {
            try await operation()
            XCTFail("Expected \(expected)")
        } catch {
            XCTAssertEqual(error as? DIPRepositoryError, expected)
        }
    }
}
