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
    var onResponse: ((PushResponseAction, PushPayload, String) async -> Void)?

    func install() {
        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().setNotificationCategories(Self.categories())
    }

    /// Every `aps.category` the server sends (docs/design/push-catalog.md, "Quick actions"). Titles follow the app language
    /// at launch. Anything that changes data runs in the background and needs an unlocked device; Open and Directions
    /// bring the app (or Maps) forward. At most two actions each, so the lock screen shows them all.
    static func categories() -> Set<UNNotificationCategory> {
        [inviteCategory(), eventGoingCategory(), reminderCategory(), chatCategory(), photoCommentCategory(), openCategory()]
    }

    /// "Can't make it": leaves the activity like the event page's Leave. Destructive (it gives up the spot) and needs an unlock.
    static func leaveAction() -> UNNotificationAction {
        UNNotificationAction(
            identifier: PushResponseAction.leaveEventAction,
            title: String(localized: "push.action.leave", defaultValue: "Can’t make it", comment: "Button on an activity notification: leaves the activity (gives up the spot) without opening the app"),
            options: [.authenticationRequired, .destructive])
    }

    /// "Open": the same as tapping the notification, offered where there is nothing else to do.
    static func openAction() -> UNNotificationAction {
        UNNotificationAction(
            identifier: PushResponseAction.openItem,
            title: String(localized: "push.action.open", defaultValue: "Open", comment: "Button on a notification: opens the activity or weekly challenge in the app"),
            options: [.foreground])
    }

    /// `DIP_EVENT_GOING` (added by an organizer, activity changed): going is implicit, so the choices are look or leave.
    static func eventGoingCategory() -> UNNotificationCategory {
        UNNotificationCategory(identifier: PushCategory.eventGoing, actions: [openAction(), leaveAction()], intentIdentifiers: [], options: [])
    }

    /// `DIP_REMINDER` (24 h and 1 h before): Directions opens Maps for the venue; Can't make it leaves.
    static func reminderCategory() -> UNNotificationCategory {
        let directions = UNNotificationAction(
            identifier: PushResponseAction.directionsAction,
            title: String(localized: "push.action.directions", defaultValue: "Directions", comment: "Button on an activity reminder notification: opens Maps with directions to the venue"),
            options: [.foreground])
        return UNNotificationCategory(identifier: PushCategory.reminder, actions: [directions, leaveAction()], intentIdentifiers: [], options: [])
    }

    /// `DIP_CHAT`: a text reply posted to the activity chat as the member, without opening the app.
    static func chatCategory() -> UNNotificationCategory {
        UNNotificationCategory(identifier: PushCategory.chat, actions: [replyAction(
            identifier: PushResponseAction.replyChatAction,
            placeholder: String(localized: "push.action.reply.chatPlaceholder", defaultValue: "Message", comment: "Placeholder of the reply text field on an activity chat notification"))],
            intentIdentifiers: [], options: [])
    }

    /// `DIP_PHOTO_COMMENT`: a text reply posted as a comment on the same photo.
    static func photoCommentCategory() -> UNNotificationCategory {
        UNNotificationCategory(identifier: PushCategory.photoComment, actions: [replyAction(
            identifier: PushResponseAction.replyPhotoCommentAction,
            placeholder: String(localized: "push.action.reply.commentPlaceholder", defaultValue: "Add a comment", comment: "Placeholder of the reply text field on a photo comment notification"))],
            intentIdentifiers: [], options: [])
    }

    /// A text reply sent in the background; it posts as the member, so it needs an unlocked device.
    private static func replyAction(identifier: String, placeholder: String) -> UNTextInputNotificationAction {
        UNTextInputNotificationAction(
            identifier: identifier,
            title: String(localized: "push.action.reply", defaultValue: "Reply", comment: "Button on a chat or photo comment notification: opens a text field to answer without opening the app"),
            options: [.authenticationRequired],
            textInputButtonTitle: String(localized: "push.action.reply.send", defaultValue: "Send", comment: "Send button of the reply text field on a chat or photo comment notification"),
            textInputPlaceholder: placeholder)
    }

    /// `DIP_OPEN`: pushes with nothing to answer (cancelled, spot released, invitation accepted, new photo, challenges).
    static func openCategory() -> UNNotificationCategory {
        UNNotificationCategory(identifier: PushCategory.open, actions: [openAction()], intentIdentifiers: [], options: [])
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

    func postActionFallback(_ kind: PushActionFallback, link: URL?) async {
        let content = UNMutableNotificationContent()
        switch kind {
        case .invite:
            content.title = String(localized: "push.invite.fallback.title", defaultValue: "Couldn’t answer the invitation", comment: "Local notification after an Accept or Decline button on an invitation notification failed")
            content.body = String(localized: "push.invite.fallback.body", defaultValue: "Open the activity in DIP to answer it.", comment: "Local notification body after answering an invitation from a notification failed; tapping it opens the activity")
        case .leave:
            content.title = String(localized: "push.leave.fallback.title", defaultValue: "Couldn’t leave the activity", comment: "Local notification after the Can't make it button on an activity notification failed")
            content.body = String(localized: "push.leave.fallback.body", defaultValue: "You’re still going. Open the activity in DIP to leave it.", comment: "Local notification body after leaving an activity from a notification failed; tapping it opens the activity")
        case .reply:
            content.title = String(localized: "push.reply.fallback.title", defaultValue: "Couldn’t send your reply", comment: "Local notification after a Reply typed on a chat or photo comment notification could not be sent")
            content.body = String(localized: "push.reply.fallback.body", defaultValue: "Open DIP to try again.", comment: "Local notification body after a reply from a notification failed; tapping it opens the chat or the activity")
        }
        if let link { content.userInfo = ["deepLink": link.absoluteString] }
        let request = UNNotificationRequest(identifier: "action-fallback-" + UUID().uuidString, content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }

    func openExternal(_ url: URL) async {
        // Only the Maps links built by DIPEventMetadata reach here (https://maps.apple.com/...).
        guard url.scheme == "https", url.host == "maps.apple.com" else { return }
        _ = await UIApplication.shared.open(url)
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
        let action = PushResponseAction(identifier: response.actionIdentifier,
                                        text: (response as? UNTextInputNotificationResponse)?.userText)
        let payload = PushPayload(userInfo: response.notification.request.content.userInfo)
        let notificationID = response.notification.request.identifier
        // Awaited, so iOS keeps a background launch for an action alive until the answer was sent.
        await deliver(action, payload, notificationID)
    }

    private func deliver(_ action: PushResponseAction, _ payload: PushPayload, _ notificationID: String) async {
        await onResponse?(action, payload, notificationID)
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
        // Can't make it, Directions and Reply use the same RSVP, event, chat and album calls as the app.
        let quickActions = PushQuickActionResponder(makeActions: { FirebaseBootstrap.makePushMemberActions(companyID: $0) })
        let coordinator = PushCoordinator(registrar: registrar, system: system, store: store, enabled: true,
                                          inviteResponder: invites, quickActions: quickActions)
        system.onToken = { token in Task { @MainActor in await coordinator.tokenChanged(token) } }
        // Links are buffered until the inbox is attached (cold launch).
        system.onResponse = { action, payload, notificationID in
            await coordinator.handleResponse(action, payload: payload, notificationID: notificationID)
        }
        system.install()
        return coordinator
    }
}
