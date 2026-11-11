import DIPCore
import Foundation

// Push client (DEVICE-UNVERIFIED): real delivery needs the paid Apple team's APNs key and the `aps-environment`
// entitlement (see docs/design/push-client.md). Everything here is behind `PushFeature.isEnabled` and tested with fakes.

/// registerDeviceV1 / unregisterDeviceV1.
@MainActor protocol PushDeviceAPI: AnyObject {
    func register(token: String, appVersion: String) async throws
    func unregister(token: String) async throws
}

/// Notification authorization and the FCM token, behind a seam so tests never touch the system.
@MainActor protocol PushSystem: AnyObject {
    func authorization() async -> DIPPushAuthorization
    /// Shows the system permission prompt; returns whether it was granted.
    func requestAuthorization() async -> Bool
    func registerForRemoteNotifications()
    /// The current FCM token, nil until APNs registration finished.
    func currentToken() async -> String?
    /// Drops the FCM token so the next member on this phone gets a fresh one (best effort).
    func deleteToken() async
}

/// Small persistent flags so the app never re-prompts or re-registers needlessly.
protocol PushStateStore: AnyObject {
    var hasPrimed: Bool { get set }
    /// "uid|token" of the last successful registration: per member, so a different member on the same phone
    /// always registers again even after an unclean session end.
    var registeredKey: String? { get set }
    /// A token whose unregister failed at sign-out; retried at the next sign-in.
    var pendingUnregisterToken: String? { get set }
}

/// Feature flag: off unless `DIPPushEnabled` is YES in Info.plist (build setting DIP_PUSH_ENABLED) or the
/// `--push-enabled` launch argument is passed. Containment: Info.plist also sets FirebaseMessagingAutoInitEnabled=NO,
/// and `PushComposition.make()` turns FCM auto-init on only when this flag is true, so with the flag off no token is
/// minted and no FCM network traffic starts.
enum PushFeature {
    static var isEnabled: Bool {
        if ProcessInfo.processInfo.arguments.contains("--push-enabled") { return true }
        return (Bundle.main.object(forInfoDictionaryKey: "DIPPushEnabled") as? String)?.uppercased() == "YES"
    }
}

/// Registers the device for the signed-in member, keeps the token current, and unregisters before sign-out.
/// Never throws to callers: push is best-effort and must not block sign-in, RSVP or sign-out.
@MainActor final class PushRegistrar {
    private let api: any PushDeviceAPI
    private let system: any PushSystem
    private let store: any PushStateStore
    private let appVersion: String
    private let enabled: Bool
    private var uid: String?

    init(api: any PushDeviceAPI, system: any PushSystem, store: any PushStateStore, appVersion: String, enabled: Bool) {
        self.api = api; self.system = system; self.store = store; self.appVersion = appVersion; self.enabled = enabled
    }

    /// Member session is ready: if already authorized, register for remote notifications and sync the token.
    func memberSignedIn(uid: String) async {
        guard enabled else { return }
        self.uid = uid
        await retryPendingUnregister()
        await refresh()
    }

    /// Also called when the app becomes active, so a permission granted later in iOS Settings takes effect.
    func refresh() async {
        guard enabled, uid != nil else { return }
        guard DIPPushPriming.canReceive(await system.authorization()) else { return }
        system.registerForRemoteNotifications()
        if let token = await system.currentToken() { await sync(token: token) }
    }

    /// FCM delivered a (new) token.
    func tokenChanged(_ token: String) async {
        guard enabled, uid != nil, !token.isEmpty else { return }
        await sync(token: token)
    }

    /// Before sign-out: remove this device's registration (idempotent server side) and the FCM token. If the call
    /// fails the token is remembered and retried at the next sign-in; sign-out is never blocked.
    func memberSigningOut() async {
        guard enabled else { return }
        let signedOutUid = uid
        uid = nil
        if let key = store.registeredKey, signedOutUid.map({ key.hasPrefix($0 + "|") }) ?? true,
           let token = Self.token(from: key) {
            store.pendingUnregisterToken = token
            store.registeredKey = nil
            await retryPendingUnregister()
        }
        await system.deleteToken()
    }

    /// The permission prompt (after priming). Registers right away when granted.
    func requestPermission() async -> Bool {
        guard enabled else { return false }
        store.hasPrimed = true
        let granted = await system.requestAuthorization()
        if granted { await refresh() }
        return granted
    }

    private func retryPendingUnregister() async {
        guard let token = store.pendingUnregisterToken else { return }
        do { try await api.unregister(token: token); store.pendingUnregisterToken = nil } catch { /* retried next sign-in */ }
    }

    private func sync(token: String) async {
        guard let uid else { return }
        let key = uid + "|" + token
        guard key != store.registeredKey else { return }
        do {
            try await api.register(token: token, appVersion: appVersion)
            store.registeredKey = key
            if store.pendingUnregisterToken == token { store.pendingUnregisterToken = nil }
        } catch { /* retried at the next launch, activation or token refresh */ }
    }

    private static func token(from key: String) -> String? {
        key.firstIndex(of: "|").map { String(key[key.index(after: $0)...]) }
    }
}
