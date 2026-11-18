import DIPCore
import Foundation
import Observation

/// Profile > Notifications: the system permission, one switch per push category, and the per-activity explainer.
/// Toggling is optimistic: the switch moves at once, one write per change (saves run in order, each writes the latest
/// state), and a failed write puts that switch back and shows a message the member can retry.
@MainActor @Observable
public final class DIPNotificationSettingsModel {
    public enum Phase: Equatable, Sendable { case loading, ready, failed(String) }

    /// Screen sections in order.
    public enum Section: String, CaseIterable, Sendable {
        case push, email

        public var title: String {
            switch self { case .push: String(localized: "notificationSettings.channel.push", defaultValue: "Push", bundle: .module, comment: "Settings section title for push notifications"); case .email: String(localized: "notificationSettings.channel.email", defaultValue: "Email", bundle: .module, comment: "Settings section title for email notifications") }
        }
        public var channel: DIPNotificationChannel {
            switch self { case .push: .push; case .email: .email }
        }
    }

    public struct Row: Equatable, Identifiable, Sendable {
        public let category: DIPNotificationCategory
        public let title: String
        public let summary: String
        public let isOn: Bool
        public var id: String { category.rawValue }
    }

    public enum MasterAction: Equatable, Sendable { case turnOn, openSettings }

    public static var perActivityTitle: String { String(localized: "notificationSettings.perActivity.title", defaultValue: "Per-activity settings", bundle: .module, comment: "Per-activity explainer title") }
    public static var perActivityMessage: String { String(localized: "notificationSettings.perActivity.message", defaultValue: "Each activity has a bell in its chat. It overrides the chat, change and reminder switches for that activity.", bundle: .module, comment: "Per-activity explainer body") }
    public static var emailFootnote: String { String(localized: "notificationSettings.email.footnote", defaultValue: "Emails go to your Google account address. Every email has an unsubscribe link.", bundle: .module, comment: "Footnote under the email section") }
    public static var disabledFootnote: String { String(localized: "notificationSettings.disabled.footnote", defaultValue: "Allow notifications to change these.", bundle: .module, comment: "Footnote when notification switches are disabled") }
    public static var saveFailureMessage: String { String(localized: "notificationSettings.error.save", defaultValue: "Couldn’t save that change. Check your connection and try again.", bundle: .module, comment: "Error when saving a notification switch failed") }
    public static var loadFailureMessage: String { String(localized: "notificationSettings.error.load", defaultValue: "Couldn’t load your notification settings. Check your connection and try again.", bundle: .module, comment: "Error when loading notification settings failed") }

    public private(set) var phase: Phase = .loading
    public private(set) var authorization: DIPPushAuthorization = .notDetermined
    public private(set) var preferences: DIPNotificationPreferences = .defaults
    public private(set) var saveError: String?

    @ObservationIgnored private let repository: any DIPNotificationPreferencesRepository
    /// nil when the push client is off in this build: the screen then offers email only.
    @ObservationIgnored private let permission: (any DIPNotificationPermissionProviding)?
    @ObservationIgnored private var saveChain: Task<Void, Never>?
    /// Counts every accepted toggle, and the saves not finished yet; `load()` uses both to avoid clobbering newer state.
    @ObservationIgnored private var edits = 0
    @ObservationIgnored private var inFlightSaves = 0
    @ObservationIgnored private var failedChange: (category: DIPNotificationCategory, channel: DIPNotificationChannel, value: Bool)?

    /// - Parameter permission: the iOS permission seam; pass nil when push is unavailable (flag off). Email preferences
    ///   do not depend on push, so the screen stays reachable and shows the Email section only.
    public init(repository: any DIPNotificationPreferencesRepository, permission: (any DIPNotificationPermissionProviding)?) {
        self.repository = repository; self.permission = permission
    }

    /// False when the push client is off in this build: no permission row and no Push section.
    public var isPushAvailable: Bool { permission != nil }

    /// The sections to show, in order.
    public var sections: [Section] { isPushAvailable ? [.push, .email] : [.email] }

    // MARK: Loading

    public func load() async {
        // Reopening the screen refreshes quietly; only a first load or a retry shows the loading state.
        if phase != .ready { phase = .loading }
        authorization = await permission?.status() ?? .notDetermined
        let editsAtStart = edits
        do {
            let loaded = try await repository.load()
            // A switch moved (or is still saving) since this read began: the read predates it and would put the old
            // value back under the member's finger. Keep the optimistic state; the writes are the newer truth.
            if edits == editsAtStart, inFlightSaves == 0 { preferences = loaded }
            phase = .ready
        } catch {
            // A quiet refresh that fails keeps what is on screen.
            if phase != .ready { phase = .failed(Self.loadFailureMessage) }
        }
    }

    /// Called when the app returns to the foreground: a permission changed in iOS Settings shows up here.
    public func refreshPermission() async { if let permission { authorization = await permission.status() } }

    // MARK: Permission (master row)

    public var canReceivePush: Bool { DIPPushPriming.canReceive(authorization) }

    public var masterTitle: String {
        switch authorization {
        case .authorized, .provisional, .ephemeral: String(localized: "notificationSettings.master.on", defaultValue: "Push notifications are on", bundle: .module, comment: "Permission row title when push is allowed")
        case .denied: String(localized: "notificationSettings.master.off", defaultValue: "Push is off", bundle: .module, comment: "Permission row title when push is not allowed")
        case .notDetermined: String(localized: "notificationSettings.master.off", defaultValue: "Push is off", bundle: .module, comment: "Permission row title when push is not allowed")
        }
    }

    public var masterDetail: String? {
        switch authorization {
        case .authorized, .provisional, .ephemeral: nil
        case .denied: String(localized: "notificationSettings.master.deniedDetail", defaultValue: "Allow notifications for DIP in iOS Settings to get alerts on this phone.", bundle: .module, comment: "Permission row detail when notifications are denied in iOS Settings")
        case .notDetermined: nil
        }
    }

    public var masterAction: MasterAction? {
        guard isPushAvailable else { return nil }
        switch authorization {
        case .authorized, .provisional, .ephemeral: return nil
        case .denied: return .openSettings
        case .notDetermined: return .turnOn
        }
    }

    public var masterActionTitle: String? {
        switch masterAction {
        case .turnOn: String(localized: "notificationSettings.master.turnOn", defaultValue: "Turn on notifications", bundle: .module, comment: "Button that asks for notification permission")
        case .openSettings: String(localized: "notificationSettings.master.openSettings", defaultValue: "Open Settings", bundle: .module, comment: "Button that opens iOS Settings")
        case nil: nil
        }
    }

    public func performMasterAction() async {
        switch masterAction {
        case .openSettings: permission?.openSettings()
        case .turnOn: if let permission { authorization = await permission.turnOn() }
        case nil: break
        }
    }

    // MARK: Rows

    /// Switches stay visible but cannot change while push is not allowed (the stored choice is untouched).
    public var areSwitchesEnabled: Bool { phase == .ready && isPushAvailable && canReceivePush }

    /// Email switches do not depend on the iOS push permission; push switches do.
    public func areSwitchesEnabled(in section: Section) -> Bool {
        switch section {
        case .push: areSwitchesEnabled
        case .email: phase == .ready
        }
    }

    public func rows(in section: Section) -> [Row] {
        Self.visibleCategories(on: section.channel).map {
            Row(category: $0, title: $0.title, summary: $0.summary, isOn: preferences.isEnabled($0, on: section.channel))
        }
    }

    public var pushRows: [Row] { rows(in: .push) }
    public var emailRows: [Row] { rows(in: .email) }

    /// Categories shown per channel. `discovery` stays hidden on email: no discovery email exists yet, so a switch
    /// would promise something the server never sends. Show it when that email ships.
    static func visibleCategories(on channel: DIPNotificationChannel) -> [DIPNotificationCategory] {
        let offered = DIPNotificationCategory.offered(on: channel)
        return channel == .email ? offered.filter { $0 != .discovery } : offered
    }

    // MARK: Toggling

    /// Push switch (kept for existing call sites).
    public func toggle(_ category: DIPNotificationCategory, to value: Bool) async {
        await toggle(category, on: .push, to: value)
    }

    public func toggle(_ category: DIPNotificationCategory, on channel: DIPNotificationChannel, to value: Bool) async {
        let section: Section = channel == .push ? .push : .email
        guard areSwitchesEnabled(in: section), Self.visibleCategories(on: channel).contains(category),
              preferences.isEnabled(category, on: channel) != value else { return }
        saveError = nil
        failedChange = nil
        edits += 1
        inFlightSaves += 1
        preferences = preferences.setting(category, on: channel, to: value)
        let previous = saveChain
        let task = Task { [weak self] in
            await previous?.value
            await self?.persist(category, on: channel, from: !value, to: value)
        }
        saveChain = task
        await task.value
    }

    /// Re-applies the change that just failed.
    public func retryFailedChange() async {
        guard let failedChange else { return }
        await toggle(failedChange.category, on: failedChange.channel, to: failedChange.value)
    }

    public func dismissSaveError() { saveError = nil; failedChange = nil }

    private func persist(_ category: DIPNotificationCategory, on channel: DIPNotificationChannel, from before: Bool, to value: Bool) async {
        defer { inFlightSaves -= 1 }
        do { try await repository.save(preferences, on: channel) }
        catch {
            // Put only this switch back; other switches the member has since moved keep their state.
            if preferences.isEnabled(category, on: channel) == value {
                preferences = preferences.setting(category, on: channel, to: before)
            }
            saveError = Self.saveFailureMessage
            failedChange = (category, channel, value)
        }
    }
}
