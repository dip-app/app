import DIPCore
import Foundation

// Push client (DEVICE-UNVERIFIED): real delivery needs the paid Apple team's APNs key and the `aps-environment`
// entitlement (see docs/design/push-client.md). Everything here is behind `PushFeature.isEnabled` and tested with fakes.

// Lives here (not in PushNotificationActions.swift) because the ComponentPreview target compiles this file but not the actions file.
/// Which local notification to post when a quick action pressed in the background could not finish.
enum PushActionFallback: Equatable, Sendable {
    case invite, leave, reply
}

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
    /// Drops the FCM token so the next member on this phone gets a fresh one. Needs no sign-in. Returns whether it worked.
    func deleteToken() async -> Bool
    /// True while DIP is in the foreground (an action pressed on a banner while the app is open).
    var isForeground: Bool { get }
    /// A quick action pressed in the background (Accept, Decline, Can't make it, Reply) could not finish: a local
    /// notification asks the member to finish in the app; tapping it opens `link` (the item), or just the app when nil.
    func postActionFallback(_ kind: PushActionFallback, link: URL?) async
    /// Opens a link outside the app (the Directions action's Maps link).
    func openExternal(_ url: URL) async
}

/// Small persistent flags so the app never re-prompts or re-registers needlessly.
protocol PushStateStore: AnyObject {
    var hasPrimed: Bool { get set }
    /// "uid|token" of the last successful registration: per member, so a different member on the same phone
    /// always registers again even after an unclean session end.
    var registeredKey: String? { get set }
    /// "uid|token" whose server unregister failed at sign-out. Only ever retried while that same uid is signed in
    /// (the callable authenticates as the caller), never as another member.
    var pendingUnregister: String? { get set }
    /// The FCM token must still be deleted (needs no sign-in): retried at activation and launch until it succeeds, so a
    /// signed-out phone stops receiving the previous member's pushes even when the server call could not be made.
    var pendingTokenDeletion: Bool { get set }
}

/// Feature flag: off unless `DIPPushEnabled` is YES in Info.plist (build setting DIP_PUSH_ENABLED) or the
/// `--push-enabled` launch argument is passed. Containment: Info.plist also sets FirebaseMessagingAutoInitEnabled=NO,
/// and `PushComposition.make()` turns FCM auto-init on only when this flag is true, so with the flag off no token is
/// minted and no FCM network traffic starts.
enum PushFeature {
    static var isEnabled: Bool {
        if MockLaunch.Flags.contains("--push-enabled") { return true }
        return (Bundle.main.object(forInfoDictionaryKey: "DIPPushEnabled") as? String)?.uppercased() == "YES"
    }
}

/// Registers the device for the signed-in member, keeps the token current, and unregisters before sign-out.
/// Never throws to callers: push is best-effort and must not block sign-in, RSVP or sign-out.
/// Every operation runs one at a time (`serialized`), and each await re-checks the uid it started for.
@MainActor final class PushRegistrar {
    private let api: any PushDeviceAPI
    private let system: any PushSystem
    private let store: any PushStateStore
    private let appVersion: String
    private let enabled: Bool
    private var uid: String?
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(api: any PushDeviceAPI, system: any PushSystem, store: any PushStateStore, appVersion: String, enabled: Bool) {
        self.api = api; self.system = system; self.store = store; self.appVersion = appVersion; self.enabled = enabled
    }

    /// Member session is ready: finish any cleanup owed, then if authorized register for remote notifications and sync the token.
    func memberSignedIn(uid: String) async {
        guard enabled else { return }
        self.uid = uid
        await serialized {
            await finishPendingCleanup(currentUID: uid)
            await refreshLocked()
        }
    }

    /// Also called when the app becomes active and at launch, so a permission changed in iOS Settings takes effect and
    /// cleanup owed from a sign-out that could not finish is retried.
    func refresh() async {
        guard enabled else { return }
        await serialized {
            await finishPendingCleanup(currentUID: uid)
            await refreshLocked()
        }
    }

    /// FCM delivered a (new) token.
    func tokenChanged(_ token: String) async {
        guard enabled, uid != nil, !token.isEmpty else { return }
        await serialized { if let uid { await sync(token: token, uid: uid) } }
    }

    /// The session ended for this device (button, expiry or a different account): remove this device's registration
    /// (idempotent server side) while the member's auth may still be valid, then delete the FCM token. If the server
    /// call fails, (uid, token) is remembered for that same uid and the token deletion is retried until it works;
    /// sign-out is never blocked.
    func memberSigningOut() async {
        guard enabled else { return }
        let signedOutUID = uid
        uid = nil   // immediately: an in-flight register sees this and records an unregister instead of persisting
        await serialized {
            if let key = store.registeredKey, signedOutUID.map({ key.hasPrefix($0 + "|") }) ?? true {
                store.pendingUnregister = key
                store.registeredKey = nil
            }
            if signedOutUID != nil || store.pendingUnregister != nil { store.pendingTokenDeletion = true }
            // Only the member who is signing out may unregister their own registration (the callable acts as the caller).
            await retryPendingUnregister(as: signedOutUID)
            await retryTokenDeletion()
        }
    }

    /// The permission prompt (after priming). Registers right away when granted.
    func requestPermission() async -> Bool {
        guard enabled else { return false }
        store.hasPrimed = true
        let granted = await system.requestAuthorization()
        if granted { await refresh() }
        return granted
    }

    // MARK: Internals (call inside `serialized`)

    private func refreshLocked() async {
        guard let uid else { return }
        let authorization = await system.authorization()
        guard self.uid == uid else { return }
        guard DIPPushPriming.canReceive(authorization) else {
            // Notifications turned off in iOS Settings while registered: stop the server sending to this device.
            if let key = store.registeredKey, key.hasPrefix(uid + "|"), let token = Self.token(from: key) {
                do { try await api.unregister(token: token); if store.registeredKey == key { store.registeredKey = nil } }
                catch { /* retried at the next activation */ }
            }
            return
        }
        system.registerForRemoteNotifications()
        let token = await system.currentToken()
        guard self.uid == uid, let token else { return }
        await sync(token: token, uid: uid)
    }

    private func finishPendingCleanup(currentUID: String?) async {
        if let pending = store.pendingUnregister, currentUID != nil {
            if Self.uid(from: pending) == currentUID {
                await retryPendingUnregister(as: currentUID)
            } else {
                // A different member is signed in; the callable would act as them. The old token is deleted below, so
                // the stale registration can no longer be reached and the server prunes it.
                store.pendingUnregister = nil
            }
        }
        await retryTokenDeletion()
    }

    /// Calls the server unregister only when `owner` is the member that registered the pending token.
    private func retryPendingUnregister(as owner: String?) async {
        guard let owner, let pending = store.pendingUnregister, Self.uid(from: pending) == owner,
              let token = Self.token(from: pending) else { return }
        do { try await api.unregister(token: token); if store.pendingUnregister == pending { store.pendingUnregister = nil } }
        catch { /* retried when this member signs in again */ }
    }

    private func retryTokenDeletion() async {
        guard store.pendingTokenDeletion else { return }
        if await system.deleteToken() { store.pendingTokenDeletion = false }
    }

    private func sync(token: String, uid: String) async {
        let key = uid + "|" + token
        guard key != store.registeredKey else { return }
        do {
            try await api.register(token: token, appVersion: appVersion)
            if self.uid == uid {
                store.registeredKey = key
                if store.pendingUnregister == key { store.pendingUnregister = nil }
            } else {
                // Signed out (or switched) while the call was in flight: the server now holds this registration.
                store.pendingUnregister = key
                store.pendingTokenDeletion = true
            }
        } catch { /* retried at the next launch, activation or token refresh */ }
    }

    private func serialized(_ body: () async -> Void) async {
        if busy { await withCheckedContinuation { waiters.append($0) } } else { busy = true }
        await body()
        if waiters.isEmpty { busy = false } else { waiters.removeFirst().resume() }
    }

    private static func token(from key: String) -> String? {
        key.firstIndex(of: "|").map { String(key[key.index(after: $0)...]) }
    }

    private static func uid(from key: String) -> String? {
        key.firstIndex(of: "|").map { String(key[..<$0]) }
    }
}
