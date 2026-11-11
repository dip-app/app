import Foundation

/// Album policy shared with gcp/storage.rules and finalizeEventPhotoV1 (docs/contracts/callables.md#event-photo-albums).
enum AlbumPolicy {
    /// One create-only Storage object per slot: a member holds at most this many photos per event.
    static let slotsPerMember = 20
    static let maxBytes = 10 * 1024 * 1024
    /// Long edge of the uploaded JPEG.
    static let maxPixelSize = 2048
    /// Long edge of the in-memory display copy (grid and viewer).
    static let displayPixelSize = 1200
    /// Album listener size (rules allow lists up to 100).
    static let albumLimit = 100

    static func storagePath(scope: EventReadScope, eventID: String, slot: Int) -> String {
        "companies/\(scope.companyID)/events/\(eventID)/photos/\(scope.uid)/\(slot)"
    }
    static func photoID(uid: String, slot: Int) -> String { "\(uid)_\(slot)" }

    /// The slot of one of the member's own album photos, or nil for anyone else's photo.
    static func slot(photoID: String, uid: String) -> Int? {
        let prefix = "\(uid)_"
        guard photoID.hasPrefix(prefix), let slot = Int(photoID.dropFirst(prefix.count)),
              String(slot) == photoID.dropFirst(prefix.count), (0..<slotsPerMember).contains(slot) else { return nil }
        return slot
    }

    /// Lowest slot that is neither published, occupied by an orphan, nor reserved by an in-flight upload.
    static func freeSlot(taken: Set<Int>) -> Int? {
        (0..<slotsPerMember).first { !taken.contains($0) }
    }
}

/// One published album photo (server-written `EventPhoto`); bytes are read separately through Storage.
struct AlbumPhotoRecord: Equatable, Sendable {
    let id: String
    let uploaderID: String
    let uploaderName: String
    let storagePath: String
    let createdAt: Date
    let commentCount: Int
}

struct PhotoCommentRecord: Equatable, Sendable {
    let id: String
    let authorID: String
    let authorName: String
    let text: String
    let createdAt: Date
}

/// What an upload attempt found in its Storage slot.
enum AlbumUploadOutcome: Equatable, Sendable {
    /// The bytes are in the slot (just uploaded, or a previous attempt of this same photo already landed).
    case stored
    /// Another, never-finalized upload holds the slot; try the next one.
    case slotOccupied
}

/// User-facing album failures, mapped from finalizeEventPhotoV1 reasons and SDK errors.
enum AlbumFailure: Error, Equatable {
    case notAttendee, notEnded, cancelled, limitReached, invalidImage, tooLarge, unauthenticated, unavailable, unknown

    var message: String {
        switch self {
        case .notAttendee: "Only people who went to this event can add photos."
        case .notEnded: "You can add photos after the event ends."
        case .cancelled: "This event was cancelled."
        case .limitReached: "You’ve added the most photos allowed for this event (\(AlbumPolicy.slotsPerMember))."
        case .invalidImage: "This photo couldn’t be read. Choose another one."
        case .tooLarge: "This photo is too large to upload."
        case .unauthenticated: "Please sign in again."
        case .unavailable: "You’re offline. Check your connection and try again."
        case .unknown: "This photo couldn’t be added. Try again."
        }
    }
}

/// Live album reads and writes for one membership scope. `stop()` removes every listener and cancels uploads.
@MainActor protocol PhotoAlbumSource: AnyObject {
    /// Newest `AlbumPolicy.albumLimit` published photos, newest first, updated live.
    func observePhotos(scope: EventReadScope, eventID: String) -> AsyncThrowingStream<[AlbumPhotoRecord], Error>
    /// IDs of the member's own published photos for the event (used to pick free slots).
    func ownPhotoIDs(scope: EventReadScope, eventID: String) async throws -> Set<String>
    /// Authenticated download of a published (or own) object.
    func imageData(path: String) async throws -> Data
    /// Uploads into the slot (create-only); progress in 0...1.
    func upload(scope: EventReadScope, eventID: String, slot: Int, jpeg: Data,
                progress: @escaping @Sendable (Double) -> Void) async throws -> AlbumUploadOutcome
    /// finalizeEventPhotoV1; idempotent per slot. Returns the published photo ID.
    func finalize(scope: EventReadScope, eventID: String, slot: Int) async throws -> String
    /// Oldest-first comments of one photo (newest 100), updated live; pending local writes included.
    func observeComments(scope: EventReadScope, eventID: String, photoID: String) -> AsyncThrowingStream<[PhotoCommentRecord], Error>
    /// Own-author append; idempotent on `commentID`.
    func addComment(scope: EventReadScope, eventID: String, photoID: String, commentID: String, text: String,
                    author: ChatAuthor) async throws
    func stop()
}
