import Foundation

/// UI depends only on this protocol. Implementations own state, validation and persistence.
/// A future Firebase adapter merges only authorized, scoped listeners into this projection.
public protocol DIPRepository: Sendable {
    func observe() async -> AsyncThrowingStream<DIPAppSnapshot, Error>
    func setRSVP(eventID: String, going: Bool) async throws
    func setChallengeJoined(challengeID: String, joined: Bool) async throws
    func updateProfile(_ edit: ProfileEdit) async throws
    func sendMessage(eventID: String, messageID: String, text: String) async throws
    /// Per-event notification preference; nil when the adapter has none (defaults in DIPNotificationLevel.swift).
    func notificationLevel(eventID: String) async throws -> DIPNotificationLevel?
    func setNotificationLevel(eventID: String, level: DIPNotificationLevel) async throws
    func addPhotos(eventID: String, photos: [PhotoUpload]) async throws
    /// Uploads one prepared photo, reporting progress in 0...1, and returns the published album photo ID.
    /// Retrying with the same `PhotoUpload.id` must never publish the photo twice.
    func uploadPhoto(eventID: String, photo: PhotoUpload, progress: @escaping @Sendable (Double) -> Void) async throws -> String
    func addPhotoComment(eventID: String, photoID: String, commentID: String, text: String) async throws
}

public enum DIPRepositoryError: Error, Equatable, Sendable {
    case notFound(String)
    case invalidInput(String)
    case injectedFailure(String)
}

public extension DIPRepository {
    /// Adapters without challenge support refuse instead of pretending to join.
    func setChallengeJoined(challengeID: String, joined: Bool) async throws {
        throw DIPRepositoryError.invalidInput("Challenges aren’t available yet")
    }

    /// Adapters without a per-photo pipeline import the photo through `addPhotos` (in-memory fixtures).
    func uploadPhoto(eventID: String, photo: PhotoUpload, progress: @escaping @Sendable (Double) -> Void) async throws -> String {
        try await addPhotos(eventID: eventID, photos: [photo])
        progress(1)
        return photo.id
    }
}
