import DIPCore
import Foundation
import Observation

/// Glue for the UI: decides when to show the priming dialog (only after a first successful join, once) and
/// forwards deep links from notification taps. Device-unverified; see PushRegistrar.
@Observable @MainActor
final class PushCoordinator {
    private(set) var isPrimingVisible = false
    private let registrar: PushRegistrar
    private let system: any PushSystem
    private let store: any PushStateStore
    private let enabled: Bool
    /// Links from taps that arrived before a handler was attached (cold launch) wait here.
    private var pendingLinks: [URL] = []
    /// Notification taps become `dip://` links handled by the same inbox as share links.
    @ObservationIgnored var onLink: ((URL) -> Void)? {
        didSet {
            guard let onLink, !pendingLinks.isEmpty else { return }
            let waiting = pendingLinks
            pendingLinks.removeAll()
            waiting.forEach(onLink)
        }
    }

    /// Answers invitations from the Accept and Decline buttons; nil leaves the buttons opening the activity instead.
    private let inviteResponder: PushInviteResponder?
    /// Runs Can't make it, Directions and Reply; nil leaves those buttons opening the item instead.
    private let quickActions: PushQuickActionResponder?

    init(registrar: PushRegistrar, system: any PushSystem, store: any PushStateStore, enabled: Bool,
         inviteResponder: PushInviteResponder? = nil, quickActions: PushQuickActionResponder? = nil) {
        self.registrar = registrar; self.system = system; self.store = store; self.enabled = enabled
        self.inviteResponder = inviteResponder; self.quickActions = quickActions
    }

    func memberSignedIn(uid: String) async { await registrar.memberSignedIn(uid: uid) }
    func refresh() async { await registrar.refresh() }
    func tokenChanged(_ token: String) async { await registrar.tokenChanged(token) }
    func signingOut() async { await registrar.memberSigningOut() }

    /// Called after the member's RSVP to an activity was accepted.
    func didJoin() async {
        let authorization = await system.authorization()
        if DIPPushPriming.shouldPrime(featureEnabled: enabled, authorization: authorization,
                                      alreadyPrimed: store.hasPrimed, justJoined: true) {
            isPrimingVisible = true
        }
    }

    func primingAccepted() async {
        isPrimingVisible = false
        _ = await registrar.requestPermission()
    }

    func primingDeclined() {
        isPrimingVisible = false
        store.hasPrimed = true   // never nag: Settings can still turn notifications on
    }

    /// The notifications center's permission banner: only exists while the push client is enabled.
    var permissionControl: PushPermissionControl {
        PushPermissionControl(
            status: { [system] in await system.authorization() },
            turnOn: { [weak self, system] in
                // An explicit tap in the center; the system prompt only ever appears while the status is undetermined.
                if await system.authorization() == .notDetermined { _ = await self?.registrar.requestPermission() }
                return await system.authorization()
            },
            openSettings: PushPermissionControl.settingsOpener())
    }

    /// A delivered notification was tapped or one of its buttons pressed. Returns when the work is done, so a background
    /// launch for an action stays alive until the answer was sent.
    /// `notificationID` (the delivered notification's request identifier) makes a Reply idempotent.
    func handleResponse(_ action: PushResponseAction, payload: PushPayload, notificationID: String = "") async {
        let outcome: PushQuickActionResponder.Outcome
        switch action {
        case .open:
            // Any push type, known or not, opens its link (or the app only, when it has none).
            outcome = .openLink(payload.link)
        case .answerInvite(let accept):
            switch await inviteResponder?.answer(accept: accept, payload: payload) ?? .openInvite(payload.link) {
            case .answered, .ignored: outcome = .done
            case .openInvite(let link): outcome = .fallback(.invite, link)
            }
        case .leaveEvent:
            outcome = await quickActions?.leave(payload: payload) ?? .fallback(.leave, payload.link)
        case .directions:
            outcome = await quickActions?.directions(payload: payload) ?? .openLink(payload.link)
        case .replyChat(let text):
            outcome = await quickActions?.replyChat(text: text, payload: payload, notificationID: notificationID) ?? .fallback(.reply, payload.link)
        case .replyPhotoComment(let text):
            outcome = await quickActions?.replyPhotoComment(text: text, payload: payload, notificationID: notificationID)
                ?? .fallback(.reply, payload.link)
        }
        switch outcome {
        case .done, .ignored: return
        case .openExternal(let url): await system.openExternal(url)
        case .openLink(let link): if let link { handleDeepLink(link.absoluteString) }
        case .fallback(let kind, let link):
            // In the foreground the item itself is the clearest fallback; in the background a local notification says so.
            if system.isForeground {
                if let link { handleDeepLink(link.absoluteString) }
            } else {
                await system.postActionFallback(kind, link: link)
            }
        }
    }

    /// A tapped notification's `deepLink` payload (`dip://events/{id}[/chat]`); anything else is ignored.
    func handleDeepLink(_ text: String) {
        guard let url = URL(string: text), DIPShareLink.destination(from: url) != nil else { return }
        if let onLink { onLink(url) } else { pendingLinks.append(url) }
    }
}
