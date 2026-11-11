import DIPCore
import Foundation
import Observation

/// Shared read projection and command coordinator. Views never manufacture successful writes.
@MainActor @Observable
public final class DIPAppViewModel {
    public private(set) var snapshot: DIPAppSnapshot?
    public private(set) var isLoading = true
    public private(set) var loadError: String?
    public private(set) var commandError: String?
    public private(set) var pendingCommands: Set<String> = []
    @ObservationIgnored private let repository: any DIPRepository
    @ObservationIgnored private var observationGeneration = UUID()

    public init(repository: any DIPRepository) { self.repository = repository }

    /// Called by the host's structured task; cancellation tears down its subscription.
    public func observe() async {
        let generation = UUID()
        observationGeneration = generation
        isLoading = snapshot == nil
        loadError = nil
        do {
            let stream = await repository.observe()
            for try await value in stream {
                guard !Task.isCancelled, observationGeneration == generation else { return }
                snapshot = value
                isLoading = false
                loadError = nil
            }
            guard !Task.isCancelled, observationGeneration == generation else { return }
            isLoading = false
            loadError = "Updates stopped. Please reconnect."
        } catch {
            guard !Task.isCancelled, observationGeneration == generation else { return }
            isLoading = false
            loadError = "Couldn’t load updates. Please try again."
        }
    }

    public func setRSVP(eventID: String, going: Bool) async throws {
        try await perform("rsvp:\(eventID)") { [repository] in
            try await repository.setRSVP(eventID: eventID, going: going)
        }
    }
    public func setChallengeJoined(challengeID: String, joined: Bool) async throws {
        try await perform("challenge:\(challengeID)") { [repository] in
            try await repository.setChallengeJoined(challengeID: challengeID, joined: joined)
        }
    }
    public func updateProfile(_ edit: ProfileEdit) async throws {
        try await perform("profile") { [repository] in try await repository.updateProfile(edit) }
    }
    public func sendMessage(eventID: String, messageID: String, text: String) async throws {
        try await perform("message:\(eventID):\(messageID)") { [repository] in
            try await repository.sendMessage(eventID: eventID, messageID: messageID, text: text)
        }
    }
    public func notificationLevel(eventID: String) async -> DIPNotificationLevel? {
        try? await repository.notificationLevel(eventID: eventID)
    }
    public func setNotificationLevel(eventID: String, level: DIPNotificationLevel) async throws {
        try await repository.setNotificationLevel(eventID: eventID, level: level)
    }
    public func addPhotos(eventID: String, photos: [PhotoUpload]) async throws {
        try await perform("photos:\(eventID)") { [repository] in
            try await repository.addPhotos(eventID: eventID, photos: photos)
        }
    }
    /// One photo of an album upload. The key is the upload's stable ID, so the same photo is never sent twice
    /// at once; a retry after a failure reuses the ID and the repository keeps it idempotent.
    public func uploadPhoto(eventID: String, photo: PhotoUpload, progress: @escaping @Sendable (Double) -> Void) async throws -> String {
        var photoID = photo.id
        try await perform("photo:\(eventID):\(photo.id)") { [repository] in
            photoID = try await repository.uploadPhoto(eventID: eventID, photo: photo, progress: progress)
        }
        return photoID
    }
    public func addPhotoComment(eventID: String, photoID: String, commentID: String, text: String) async throws {
        try await perform("comment:\(eventID):\(photoID):\(commentID)") { [repository] in
            try await repository.addPhotoComment(eventID: eventID, photoID: photoID, commentID: commentID, text: text)
        }
    }
    public func dismissCommandError() { commandError = nil }

    private func perform(_ key: String, action: () async throws -> Void) async throws {
        guard !pendingCommands.contains(key) else { throw DIPCommandInProgress() }
        pendingCommands.insert(key)
        commandError = nil
        defer { pendingCommands.remove(key) }
        do { try await action() }
        catch {
            if !(error is CancellationError) {
                commandError = "Couldn’t save that change. Please try again."
            }
            throw error
        }
        // Acknowledgement is deliberately not assigned to snapshot: only observation renders state.
    }
}

public struct DIPCommandInProgress: Error, Sendable { public init() {} }
