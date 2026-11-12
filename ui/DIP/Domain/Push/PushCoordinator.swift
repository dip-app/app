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

    init(registrar: PushRegistrar, system: any PushSystem, store: any PushStateStore, enabled: Bool) {
        self.registrar = registrar; self.system = system; self.store = store; self.enabled = enabled
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

    /// A tapped notification's `deepLink` payload (`dip://events/{id}[/chat]`); anything else is ignored.
    func handleDeepLink(_ text: String) {
        guard let url = URL(string: text), DIPShareLink.destination(from: url) != nil else { return }
        if let onLink { onLink(url) } else { pendingLinks.append(url) }
    }
}
