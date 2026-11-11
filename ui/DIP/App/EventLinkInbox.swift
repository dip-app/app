import DIPCore
import Foundation
import Observation

/// Holds an event link (`https://<host>/e/<id>` or `dip://events/<id>`) until the app can show it.
/// The app root queues here from `.onOpenURL` / Universal Link activities; the signed-in member shell
/// consumes it once membership is resolved and onboarding is finished. Only the opaque event id is
/// kept; the shell resolves it against the member's own company (other companies see "unavailable").
@Observable @MainActor
final class EventLinkInbox {
    private(set) var pendingEventID: String?
    /// `dip://events/<id>/chat` (push taps) asks for the chat once the event is open.
    private(set) var pendingOpensChat = false

    /// Queues the event id of `url`. Returns false (and queues nothing) when it is not an event link.
    @discardableResult
    func receive(_ url: URL) -> Bool {
        guard let destination = DIPShareLink.destination(from: url) else { return false }
        pendingEventID = destination.eventID
        pendingOpensChat = destination.opensChat
        return true
    }

    func consume(_ id: String) {
        if pendingEventID == id { pendingEventID = nil; pendingOpensChat = false }
    }
}
