import DIPCore
import DIPDesignSystem
import Foundation

/// The persistent bar's action for a routed page, as a pure function of the route and the observed snapshot.
///
/// Extracted unchanged from `DIPPrototypeApp.bottomAction` so the shell and the onboarding demos
/// (which must draw the joined bar exactly as the app does) share one resolver.
enum EventBarAction {
    /// The shell's routed destinations. `DIPPrototypeApp` pushes these onto its `NavigationStack`.
    enum Route: Hashable {
        case event(String)
        case participants(String)
        case album(String)
        case challenge(String)
    }

    /// The bar action for the top route, or nil to show the tabs.
    /// - Parameters:
    ///   - route: the last pushed route, or nil at a tab root.
    ///   - snapshot: the observed read snapshot, nil while loading or after a load failure.
    ///   - isLoading: whether the first snapshot is still loading (only changes the unavailable title).
    ///   - now: the time used for started/full/cancelled checks.
    static func resolve(route: Route?, snapshot: DIPAppSnapshot?, isLoading: Bool, now: Date = Date()) -> DIPBottomBarAction? {
        switch route {
        case .event(let id):
            return forEvent(snapshot?.eventDetails[id], isLoading: isLoading, now: now)
        case .participants(let id) where snapshot?.eventDetails[id]?.isPast == true:
            return DIPBottomBarAction(title: "View Album", identifier: "participants.album")
        case .participants(let id):
            let joined = snapshot?.eventDetails[id]?.isJoined == true
            return DIPBottomBarAction(title: joined ? "Activity Chat" : "Join the Activity",
                style: joined ? .accent : .standard,
                identifier: joined ? "participants.chat" : "participants.join",
                icon: joined ? chatIcon : nil)
        case .album:
            return DIPBottomBarAction(title: "Add Photos", identifier: "album.add-photos")
        case .challenge:
            return DIPBottomBarAction(title: "Add Your Entry", identifier: "challenge.primary")
        case nil:
            return nil
        }
    }

    /// The bar action on an event page. A nil event is still loading or no longer available.
    static func forEvent(_ event: DIPEventDetail?, isLoading: Bool, now: Date = Date()) -> DIPBottomBarAction {
        guard let event else {
            return DIPBottomBarAction(
                title: isLoading ? "Loading…" : "Activity unavailable",
                style: .complete, identifier: "event.primary")
        }
        if event.isPast { return DIPBottomBarAction(title: "View Album", identifier: "event.primary") }
        let joined = event.isJoined
        if let metadata = event.metadata {
            switch metadata.state(now: now, attendeeCount: event.attendeeCount, isJoined: joined) {
            case .cancelled: return DIPBottomBarAction(title: "Activity cancelled", style: .complete, identifier: "event.primary")
            case .full: return DIPBottomBarAction(title: "Activity full", style: .complete, identifier: "event.primary")
            case .started where !joined: return DIPBottomBarAction(title: "Activity started", style: .complete, identifier: "event.primary")
            default: break
            }
        }
        return DIPBottomBarAction(
            title: joined ? "Activity Chat" : "Join the Activity",
            style: joined ? .accent : .standard,
            identifier: "event.primary", value: joined ? "Joined" : "Not joined",
            icon: joined ? chatIcon : nil)
    }

    static let chatIcon = "event_HeroiconsOutlineChatBubbleOvalLeft"
}
