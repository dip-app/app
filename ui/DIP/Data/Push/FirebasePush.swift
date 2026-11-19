import DIPCore
import FirebaseCore
import FirebaseFunctions
import FirebaseMessaging
import Foundation
import UIKit
import UserNotifications

// Firebase/APNs adapters for the push client. DEVICE-UNVERIFIED: delivery needs the paid team's APNs key and the
// aps-environment entitlement. Without them `registerForRemoteNotifications` fails quietly and no token arrives.

@MainActor final class FirebasePushDeviceAPI: PushDeviceAPI {
    private let functions: Functions
    init(functions: Functions) { self.functions = functions }

    func register(token: String, appVersion: String) async throws {
        let callable = functions.httpsCallable("registerDeviceV1")
        callable.timeoutInterval = 15   // sign-out waits behind an in-flight register; never for long
        _ = try await callable.call(["contractVersion": 1, "token": token, "platform": "ios", "appVersion": appVersion])
    }

    func unregister(token: String) async throws {
        let callable = functions.httpsCallable("unregisterDeviceV1")
        callable.timeoutInterval = 15
        _ = try await callable.call(["contractVersion": 1, "token": token])
    }
}

/// UserNotifications + FirebaseMessaging behind the `PushSystem` seam.
@MainActor final class SystemPushAdapter: NSObject, PushSystem, MessagingDelegate, UNUserNotificationCenterDelegate {
    /// FCM delivered a new token.
    var onToken: ((String) -> Void)?
    /// A tapped notification or a pressed action button, with the payload's data keys.
    var onResponse: ((PushResponseAction, PushPayload) async -> Void)?

    func install() {
        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().setNotificationCategories([Self.inviteCategory()])
    }

    /// `DIP_INVITE` (invite pushes carry it as `aps.category`). Both buttons answer in the background, without opening
    /// the app, and need an unlocked device: answering changes the member's plans and is visible to the inviter, so it
    /// must not happen from a locked lock screen. Decline is not styled destructive; it deletes nothing.
    static func inviteCategory() -> UNNotificationCategory {
        let accept = UNNotificationAction(
            identifier: PushResponseAction.acceptInvite,
            title: String(localized: "push.invite.accept", defaultValue: "Accept", comment: "Button on an invitation notification: accepts the invitation and joins the activity"),
            options: [.authenticationRequired])
        let decline = UNNotificationAction(
            identifier: PushResponseAction.declineInvite,
            title: String(localized: "push.invite.decline", defaultValue: "Decline", comment: "Button on an invitation notification: declines the invitation"),
            options: [.authenticationRequired])
        return UNNotificationCategory(identifier: PushCategory.invite, actions: [accept, decline], intentIdentifiers: [], options: [])
    }

    var isForeground: Bool { UIApplication.shared.applicationState == .active }

    func postInviteFallback(link: URL?) async {
        let content = UNMutableNotificationContent()
        content.title = String(localized: "push.invite.fallback.title", defaultValue: "Couldn’t answer the invitation", comment: "Local notification after an Accept or Decline button on an invitation notification failed")
        content.body = String(localized: "push.invite.fallback.body", defaultValue: "Open the activity in DIP to answer it.", comment: "Local notification body after answering an invitation from a notification failed; tapping it opens the activity")
        if let link { content.userInfo = ["deepLink": link.absoluteString] }
        let request = UNNotificationRequest(identifier: "invite-fallback-" + UUID().uuidString, content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }

    func authorization() async -> DIPPushAuthorization {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .notDetermined: .notDetermined
        case .denied: .denied
        case .authorized: .authorized
        case .provisional: .provisional
        case .ephemeral: .ephemeral
        @unknown default: .denied
        }
    }

    func requestAuthorization() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
    }

    func registerForRemoteNotifications() { UIApplication.shared.registerForRemoteNotifications() }

    func currentToken() async -> String? { try? await Messaging.messaging().token() }

    func deleteToken() async -> Bool {
        do { try await Messaging.messaging().deleteToken(); return true } catch { return false }
    }

    nonisolated func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken else { return }
        Task { @MainActor in self.onToken?(fcmToken) }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        // Extract plain values here: UNNotificationResponse and userInfo are not Sendable and must not cross actors.
        guard response.actionIdentifier != UNNotificationDismissActionIdentifier else { return }
        let action = PushResponseAction(identifier: response.actionIdentifier)
        let payload = PushPayload(userInfo: response.notification.request.content.userInfo)
        // Awaited, so iOS keeps a background launch for an action alive until the answer was sent.
        await deliver(action, payload)
    }

    private func deliver(_ action: PushResponseAction, _ payload: PushPayload) async {
        await onResponse?(action, payload)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

/// SwiftUI apps have no app delegate unless one is adapted in, and relying on Firebase's method swizzling to see the
/// APNs token is fragile. Hands the token to FCM explicitly; does nothing unless the push flag is on and Firebase is configured.
@MainActor final class DIPAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        guard PushFeature.isEnabled, FirebaseApp.app() != nil else { return }
        Messaging.messaging().apnsToken = deviceToken
    }
}

final class UserDefaultsPushStateStore: PushStateStore {
    private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        // Older builds stored only a token (no owner) that could never be unregistered safely: delete the FCM token instead.
        if defaults.string(forKey: "dip.push.pendingUnregister") != nil {
            defaults.removeObject(forKey: "dip.push.pendingUnregister")
            defaults.set(true, forKey: "dip.push.pendingTokenDeletion")
        }
    }
    var hasPrimed: Bool {
        get { defaults.bool(forKey: "dip.push.primed") }
        set { defaults.set(newValue, forKey: "dip.push.primed") }
    }
    var registeredKey: String? {
        get { defaults.string(forKey: "dip.push.registered") }
        set { defaults.set(newValue, forKey: "dip.push.registered") }
    }
    var pendingUnregister: String? {
        get { defaults.string(forKey: "dip.push.pendingUnregisterKey") }
        set { defaults.set(newValue, forKey: "dip.push.pendingUnregisterKey") }
    }
    var pendingTokenDeletion: Bool {
        get { defaults.bool(forKey: "dip.push.pendingTokenDeletion") }
        set { defaults.set(newValue, forKey: "dip.push.pendingTokenDeletion") }
    }
}

enum PushComposition {
    /// nil unless the feature flag is on and Firebase is configured; the rest of the app never sees push otherwise.
    @MainActor static func make() -> PushCoordinator? {
        guard PushFeature.isEnabled, FirebaseApp.app() != nil else { return nil }
        // Containment: FCM auto-init is off in Info.plist; it starts only here, when the flag is on.
        Messaging.messaging().isAutoInitEnabled = true
        let system = SystemPushAdapter()
        let store = UserDefaultsPushStateStore()
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let registrar = PushRegistrar(
            api: FirebasePushDeviceAPI(functions: Functions.functions(region: FirebaseAccountsRepository.region)),
            system: system, store: store, appVersion: version, enabled: true)
        // Accept and Decline on invite pushes use the same invites repository call as the in-app buttons.
        let invites = PushInviteResponder(makeRepository: { FirebaseBootstrap.makePushInvitesRepository(companyID: $0) })
        let coordinator = PushCoordinator(registrar: registrar, system: system, store: store, enabled: true, inviteResponder: invites)
        system.onToken = { token in Task { @MainActor in await coordinator.tokenChanged(token) } }
        // Links are buffered until the inbox is attached (cold launch).
        system.onResponse = { action, payload in await coordinator.handleResponse(action, payload: payload) }
        system.install()
        return coordinator
    }
}
