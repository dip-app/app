import DIPCore
import Foundation

public enum DIPMockOperation: Hashable, Sendable {
    case observation, rsvp, profile, message, photos, comment
}

/// Refusals of the in-memory repository: localized like the live adapter's messages (mock builds only).
enum MockMessage {
    static func reject(_ localized: String) -> DIPRepositoryError { .rejected(DIPMemberMessage(localized: localized)) }
}

/// In-memory repository used by previews and local development, never a Firebase adapter.
/// Actor isolation serializes commands; observers only receive committed snapshots.
public actor DIPMockRepository: DIPRepository {
    private var snapshot: DIPAppSnapshot
    private var observers: [UUID: AsyncThrowingStream<DIPAppSnapshot, Error>.Continuation] = [:]
    private var failures: [DIPMockOperation: String] = [:]
    public var subscriberCount: Int { observers.count }

    public init(initialSnapshot: DIPAppSnapshot = DIPMockFixtures.reference, initiallyJoinedEventIDs: Set<String> = [], initialFailures: [DIPMockOperation: String] = [:]) {
        var seed = initialSnapshot
        for id in initiallyJoinedEventIDs.sorted() where seed.eventDetails[id] != nil {
            Self.applyRSVP(eventID: id, going: true, to: &seed)
        }
        snapshot = seed
        failures = initialFailures
    }

    public func observe() async -> AsyncThrowingStream<DIPAppSnapshot, Error> {
        let (stream, continuation) = AsyncThrowingStream<DIPAppSnapshot, Error>.makeStream(bufferingPolicy: .bufferingNewest(1))
        if let message = failures.removeValue(forKey: .observation) {
            continuation.finish(throwing: DIPRepositoryError.injectedFailure(message))
            return stream
        }
        let id = UUID()
        observers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeObserver(id) }
        }
        continuation.yield(snapshot)
        return stream
    }

    public func currentSnapshot() -> DIPAppSnapshot { snapshot }

    /// Simulates an externally received update without a UI command.
    public func replaceSnapshot(_ newSnapshot: DIPAppSnapshot) {
        snapshot = newSnapshot
        publish()
    }

    public func failNext(_ operation: DIPMockOperation, message: String = "Injected failure") {
        failures[operation] = message
    }

    /// Simulates a listener failure. A fresh observe() can subscribe again to retained state.
    public func failObservation(message: String = "Injected observation failure") {
        let current = observers.values
        observers.removeAll()
        for continuation in current {
            continuation.finish(throwing: DIPRepositoryError.injectedFailure(message))
        }
    }

    public func setRSVP(eventID: String, going: Bool) async throws {
        try consumeFailure(.rsvp)
        guard let event = snapshot.eventDetails[eventID] else { throw DIPRepositoryError.notFound(eventID) }
        guard !event.isPast else { throw MockMessage.reject(String(localized: "mock.error.activityEnded", defaultValue: "This activity has ended", bundle: .module, comment: "Preview data error: joining or leaving an activity that already ended")) }
        guard event.isJoined != going else { return }
        if let metadata = event.metadata {
            guard metadata.canCancel(now: Date()) else { throw MockMessage.reject(String(localized: "mock.error.rsvpClosed", defaultValue: "RSVP changes close when the activity starts", bundle: .module, comment: "Preview data error: changing an RSVP after the activity started")) }
            if going && event.attendeeCount >= metadata.capacity { throw MockMessage.reject(String(localized: "mock.error.activityFull", defaultValue: "This activity is full", bundle: .module, comment: "Preview data error: joining an activity with no places left")) }
        }
        Self.applyRSVP(eventID: eventID, going: going, to: &snapshot)
        publish()
    }

    public func setChallengeJoined(challengeID: String, joined: Bool) async throws {
        guard var challenge = snapshot.challengeDetails[challengeID] else { throw DIPRepositoryError.notFound(challengeID) }
        guard challenge.isJoined != joined else { return }
        challenge.isJoined = joined
        snapshot.challengeDetails[challengeID] = challenge
        publish()
    }

    public func updateProfile(_ edit: ProfileEdit) async throws {
        try consumeFailure(.profile)
        guard Set(edit.interestTagIDs).count <= 10 else { throw MockMessage.reject(String(localized: "mock.error.tooManyInterests", defaultValue: "Choose up to 10 interests", bundle: .module, comment: "Preview data error: more than 10 interests selected")) }
        if let radius = edit.travelRadiusMiles, !(0...500).contains(radius) {
            throw MockMessage.reject(String(localized: "mock.error.radiusTooLarge", defaultValue: "Choose a travel radius up to 500 miles", bundle: .module, comment: "Preview data error: travel radius out of range"))
        }
        guard Set(edit.interestTagIDs).isSubset(of: Set(snapshot.profile.interestCatalog.map(\.id)).union(snapshot.profile.interestTagIDs)) else {
            throw MockMessage.reject(String(localized: "mock.error.unknownInterest", defaultValue: "Unknown interest", bundle: .module, comment: "Preview data error: an interest that is not in the catalog"))
        }
        snapshot.profile.department = edit.department.trimmingCharacters(in: .whitespacesAndNewlines)
        snapshot.profile.city = edit.city.trimmingCharacters(in: .whitespacesAndNewlines)
        if let jobTitle = edit.jobTitle { snapshot.profile.jobTitle = jobTitle.trimmingCharacters(in: .whitespacesAndNewlines) }
        if let availability = edit.availability { snapshot.profile.availability = availability }
        if let radius = edit.travelRadiusMiles { snapshot.profile.travelRadiusMiles = radius }
        let catalogIDs = snapshot.profile.interestCatalog.map(\.id)
        let retainedIDs = snapshot.profile.interestTagIDs.filter { !catalogIDs.contains($0) }
        snapshot.profile.interestTagIDs = (catalogIDs + retainedIDs).filter(Set(edit.interestTagIDs).contains)
        for id in Array(snapshot.participants.keys) {
            guard var people = snapshot.participants[id] else { continue }
            for index in people.indices where people[index].id == snapshot.profile.id {
                people[index].department = snapshot.profile.department
            }
            snapshot.participants[id] = people
        }
        publish()
    }

    public func sendMessage(eventID: String, messageID: String, text: String) async throws {
        try consumeFailure(.message)
        guard snapshot.messages[eventID] != nil,
              snapshot.eventDetails[eventID] != nil || snapshot.albums[eventID] != nil else {
            throw DIPRepositoryError.notFound(eventID)
        }
        guard let event = snapshot.eventDetails[eventID], event.isJoined, !event.isPast else {
            throw MockMessage.reject(String(localized: "mock.error.joinToMessage", defaultValue: "Join this activity before sending a message", bundle: .module, comment: "Preview data error: sending a chat message without having joined"))
        }
        let trimmed = try validatedText(text, identity: messageID, kind: .message)
        if let existing = snapshot.messages[eventID]?.first(where: { $0.id == messageID }) {
            guard existing.authorID == snapshot.profile.id && existing.text == trimmed else {
                throw MockMessage.reject(String(localized: "mock.error.messageExists", defaultValue: "Message identity already exists", bundle: .module, comment: "Preview data error: a different message was already sent with this id"))
            }
            return
        }
        snapshot.messages[eventID, default: []].append(.init(
            id: messageID, authorID: snapshot.profile.id, text: trimmed,
            authorName: snapshot.profile.displayName, authorAvatar: snapshot.profile.avatar, createdAt: Date()))
        publish()
    }

    private var notificationLevels: [String: DIPNotificationLevel] = [:]
    public func notificationLevel(eventID: String) async throws -> DIPNotificationLevel? {
        notificationLevels[eventID] ?? .changes
    }
    public func setNotificationLevel(eventID: String, level: DIPNotificationLevel) async throws {
        notificationLevels[eventID] = level
    }

    public func addPhotoComment(eventID: String, photoID: String, commentID: String, text: String) async throws {
        try consumeFailure(.comment)
        guard let album = snapshot.albums[eventID] else { throw DIPRepositoryError.notFound(eventID) }
        guard album.photos.contains(where: { $0.id == photoID }) else { throw DIPRepositoryError.notFound(photoID) }
        let trimmed = try validatedText(text, identity: commentID, kind: .comment)
        if let existing = snapshot.photoComments[eventID]?[photoID]?.first(where: { $0.id == commentID }) {
            guard existing.authorID == snapshot.profile.id && existing.text == trimmed else {
                throw MockMessage.reject(String(localized: "mock.error.commentExists", defaultValue: "Comment identity already exists", bundle: .module, comment: "Preview data error: a different comment was already sent with this id"))
            }
            return
        }
        snapshot.photoComments[eventID, default: [:]][photoID, default: []].append(.init(
            id: commentID, authorID: snapshot.profile.id, authorName: snapshot.profile.displayName,
            authorAvatar: snapshot.profile.avatar, text: trimmed, createdAt: Date()))
        publish()
    }

    public func addPhotos(eventID: String, photos: [PhotoUpload]) async throws {
        try consumeFailure(.photos)
        guard var album = snapshot.albums[eventID] else { throw DIPRepositoryError.notFound(eventID) }
        guard photos.allSatisfy({ !$0.id.isEmpty && !$0.data.isEmpty && $0.data.count <= 25_000_000 }) else {
            throw MockMessage.reject(String(localized: "mock.error.imageInvalid", defaultValue: "Choose a nonempty image smaller than 25 MB", bundle: .module, comment: "Preview data error: an empty or too large photo"))
        }
        // Validate before any mutation so a mixed invalid batch cannot partially import.
        for photo in photos {
            if let existing = album.photos.first(where: { $0.id == photo.id }), existing.image != .data(photo.data) {
                throw MockMessage.reject(String(localized: "mock.error.photoExists", defaultValue: "Photo identity already exists", bundle: .module, comment: "Preview data error: a different photo was already added with this id"))
            }
            if !album.photos.contains(where: { $0.id == photo.id }) {
                album.photos.append(.init(id: photo.id, image: .data(photo.data),
                    attribution: .init(name: snapshot.profile.displayName, avatar: snapshot.profile.avatar), isImported: true))
            }
        }
        guard snapshot.albums[eventID] != album else { return }
        snapshot.albums[eventID] = album
        publish()
    }

    private enum TextKind { case message, comment }

    /// One full sentence per kind (never "\(kind) is empty"), so each translates on its own.
    private func validatedText(_ text: String, identity: String, kind: TextKind) throws -> String {
        guard !identity.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw MockMessage.reject(kind == .message
                ? String(localized: "mock.error.messageIdRequired", defaultValue: "Message identity is required", bundle: .module, comment: "Preview data error: a chat message without an id")
                : String(localized: "mock.error.commentIdRequired", defaultValue: "Comment identity is required", bundle: .module, comment: "Preview data error: a photo comment without an id"))
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw MockMessage.reject(kind == .message
                ? String(localized: "mock.error.messageEmpty", defaultValue: "Message is empty", bundle: .module, comment: "Preview data error: an empty chat message")
                : String(localized: "mock.error.commentEmpty", defaultValue: "Comment is empty", bundle: .module, comment: "Preview data error: an empty photo comment"))
        }
        guard trimmed.count <= 2_000 else {
            throw MockMessage.reject(kind == .message
                ? String(localized: "mock.error.messageTooLong", defaultValue: "Message exceeds 2000 characters", bundle: .module, comment: "Preview data error: a chat message over the length limit")
                : String(localized: "mock.error.commentTooLong", defaultValue: "Comment exceeds 2000 characters", bundle: .module, comment: "Preview data error: a photo comment over the length limit"))
        }
        return trimmed
    }

    private func consumeFailure(_ operation: DIPMockOperation) throws {
        if let message = failures.removeValue(forKey: operation) {
            throw DIPRepositoryError.injectedFailure(message)
        }
    }

    private func publish() {
        for continuation in observers.values { continuation.yield(snapshot) }
    }

    private func removeObserver(_ id: UUID) { observers.removeValue(forKey: id) }

    private static func applyRSVP(eventID: String, going: Bool, to snapshot: inout DIPAppSnapshot) {
        guard var detail = snapshot.eventDetails[eventID], detail.isJoined != going else { return }
        let delta = going ? 1 : -1
        detail.isJoined = going
        detail.attendeeCount = max(0, detail.attendeeCount + delta)
        if let avatars = DIPMockFixtures.attendeeAvatars(eventID: eventID, going: going) {
            detail.attendeeAvatars = avatars
        }
        snapshot.eventDetails[eventID] = detail
        for index in snapshot.home.events.indices where snapshot.home.events[index].id == eventID {
            snapshot.home.events[index].attendeeCount = max(0, snapshot.home.events[index].attendeeCount + delta)
        }
        if going {
            if !snapshot.activeEvents.contains(where: { $0.id == eventID }) {
                if let summary = snapshot.home.events.first(where: { $0.id == eventID }) {
                    snapshot.activeEvents.append(summary)
                } else {
                    snapshot.activeEvents.append(.init(id: eventID, title: detail.title, locality: "", image: detail.image, attendeeCount: detail.attendeeCount))
                }
            }
            var people = snapshot.participants[eventID, default: []]
            if !people.contains(where: { $0.id == snapshot.profile.id }) {
                people.insert(.init(id: snapshot.profile.id, name: snapshot.profile.displayName, department: snapshot.profile.department, avatar: snapshot.profile.avatar), at: 0)
            }
            snapshot.participants[eventID] = people
        } else {
            snapshot.activeEvents.removeAll(where: { $0.id == eventID })
            snapshot.participants[eventID]?.removeAll(where: { $0.id == snapshot.profile.id })
        }
    }
}
