import DIPContracts
import DIPCore
@preconcurrency import FirebaseFirestore
import Foundation

/// Quick actions on a push (Can't make it, Directions, Reply) for the signed-in member in the push's company, through the
/// same sources the in-app UI uses: `setRsvpV1` (the event page's Leave), the activity chat and photo comment writes (own
/// author, client id as document id) and the event document read behind the Directions pill. DEVICE-UNVERIFIED.
///
/// A background launch has no member session on screen, so the author name and avatar the rules require are read from
/// the member's own profile (`users/{uid}`), which must belong to the push's company; a mismatch writes nothing.
@MainActor final class FirebasePushMemberActions: PushMemberActions {
    private let scope: EventReadScope
    private let firestore: Firestore
    private let participation: FirebaseParticipationSource
    private let albums: any PhotoAlbumSource

    init(scope: EventReadScope, firestore: Firestore, participation: FirebaseParticipationSource, albums: any PhotoAlbumSource) {
        self.scope = scope; self.firestore = firestore; self.participation = participation; self.albums = albums
    }

    func leave(eventID: String) async throws {
        _ = try await participation.setRsvp(scope: scope, eventID: eventID, going: false)
    }

    func sendChat(eventID: String, messageID: String, text: String) async throws {
        try await participation.sendMessage(scope: scope, eventID: eventID, messageID: messageID, text: text, author: try await author())
    }

    func commentOnPhoto(eventID: String, photoID: String, commentID: String, text: String) async throws {
        try await albums.addComment(scope: scope, eventID: eventID, photoID: photoID, commentID: commentID, text: text,
                                    author: try await author())
    }

    func directionsURL(eventID: String) async throws -> URL? {
        guard MemberEventsRepository.validID(eventID) else { return nil }
        // Server first, the local cache when offline: a venue rarely changes and Maps can still search it.
        let snapshot = try await firestore.collection("companies").document(scope.companyID).collection("events").document(eventID).getDocument()
        guard let event = try EventDocumentMapper.decode(id: snapshot.documentID, companyID: scope.companyID,
                                                         fields: snapshot.exists ? snapshot.data() : nil) else { return nil }
        return try MemberEventsRepository.metadata(event).directionsURL(fallbackTitle: event.title)
    }

    /// The member's own profile, decoded and validated like the signed-in session (it must be in the push's company).
    private func author() async throws -> ChatAuthor {
        let snapshot = try await firestore.collection("users").document(scope.uid).getDocument()
        guard let profile = try AccountDocumentMapper.decode(id: scope.uid, fields: snapshot.exists ? snapshot.data() : nil),
              profile.companyId == scope.companyID else { throw ChatFailure.unauthenticated }
        return ChatAuthor(name: profile.displayName, avatarID: profile.avatarId)
    }
}
