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
        _ = try await functions.httpsCallable("registerDeviceV1")
            .call(["contractVersion": 1, "token": token, "platform": "ios", "appVersion": appVersion])
    }

    func unregister(token: String) async throws {
        _ = try await functions.httpsCallable("unregisterDeviceV1").call(["contractVersion": 1, "token": token])
    }
}

/// UserNotifications + FirebaseMessaging behind the `PushSystem` seam.
@MainActor final class SystemPushAdapter: NSObject, PushSystem, MessagingDelegate, UNUserNotificationCenterDelegate {
    /// FCM delivered a new token.
    var onToken: ((String) -> Void)?
    /// A tapped notification's `deepLink` payload.
    var onDeepLink: ((String) -> Void)?

    func install() {
        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().delegate = self
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

    func deleteToken() async { try? await Messaging.messaging().deleteToken() }

    nonisolated func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken else { return }
        Task { @MainActor in self.onToken?(fcmToken) }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let link = response.notification.request.content.userInfo["deepLink"] as? String else { return }
        await MainActor.run { self.onDeepLink?(link) }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

final class UserDefaultsPushStateStore: PushStateStore {
    private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    var hasPrimed: Bool {
        get { defaults.bool(forKey: "dip.push.primed") }
        set { defaults.set(newValue, forKey: "dip.push.primed") }
    }
    var registeredKey: String? {
        get { defaults.string(forKey: "dip.push.registered") }
        set { defaults.set(newValue, forKey: "dip.push.registered") }
    }
    var pendingUnregisterToken: String? {
        get { defaults.string(forKey: "dip.push.pendingUnregister") }
        set { defaults.set(newValue, forKey: "dip.push.pendingUnregister") }
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
        let coordinator = PushCoordinator(registrar: registrar, system: system, store: store, enabled: true)
        system.onToken = { token in Task { @MainActor in await coordinator.tokenChanged(token) } }
        system.onDeepLink = { link in coordinator.handleDeepLink(link) }   // buffered until the inbox is attached
        system.install()
        return coordinator
    }
}
