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
            switch self { case .push: "Push"; case .email: "Email" }
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

    public static let perActivityTitle = "Per-activity settings"
    public static let perActivityMessage = "Each activity has a bell in its chat. It overrides the chat, change and reminder switches for that activity."
    public static let emailFootnote = "Emails go to your Google account address. Every email has an unsubscribe link."
    public static let disabledFootnote = "Allow notifications to change these."
    public static let saveFailureMessage = "Couldn’t save that change. Check your connection and try again."
    public static let loadFailureMessage = "Couldn’t load your notification settings. Check your connection and try again."

    public private(set) var phase: Phase = .loading
    public private(set) var authorization: DIPPushAuthorization = .notDetermined
    public private(set) var preferences: DIPNotificationPreferences = .defaults
    public private(set) var saveError: String?

    @ObservationIgnored private let repository: any DIPNotificationPreferencesRepository
    @ObservationIgnored private let permission: any DIPNotificationPermissionProviding
    @ObservationIgnored private var saveChain: Task<Void, Never>?
    @ObservationIgnored private var failedChange: (category: DIPNotificationCategory, channel: DIPNotificationChannel, value: Bool)?

    public init(repository: any DIPNotificationPreferencesRepository, permission: any DIPNotificationPermissionProviding) {
        self.repository = repository; self.permission = permission
    }

    // MARK: Loading

    public func load() async {
        // Reopening the screen refreshes quietly; only a first load or a retry shows the loading state.
        if phase != .ready { phase = .loading }
        authorization = await permission.status()
        do {
            preferences = try await repository.load()
            phase = .ready
        } catch {
            // A quiet refresh that fails keeps what is on screen.
            if phase != .ready { phase = .failed(Self.loadFailureMessage) }
        }
    }

    /// Called when the app returns to the foreground: a permission changed in iOS Settings shows up here.
    public func refreshPermission() async { authorization = await permission.status() }

    // MARK: Permission (master row)

    public var canReceivePush: Bool { DIPPushPriming.canReceive(authorization) }

    public var masterTitle: String {
        switch authorization {
        case .authorized, .provisional, .ephemeral: "Push notifications are on"
        case .denied: "Push is off"
        case .notDetermined: "Push is off"
        }
    }

    public var masterDetail: String? {
        switch authorization {
        case .authorized, .provisional, .ephemeral: nil
        case .denied: "Allow notifications for DIP in iOS Settings to get alerts on this phone."
        case .notDetermined: nil
        }
    }

    public var masterAction: MasterAction? {
        switch authorization {
        case .authorized, .provisional, .ephemeral: nil
        case .denied: .openSettings
        case .notDetermined: .turnOn
        }
    }

    public var masterActionTitle: String? {
        switch masterAction {
        case .turnOn: "Turn on notifications"
        case .openSettings: "Open Settings"
        case nil: nil
        }
    }

    public func performMasterAction() async {
        switch masterAction {
        case .openSettings: permission.openSettings()
        case .turnOn: authorization = await permission.turnOn()
        case nil: break
        }
    }

    // MARK: Rows

    /// Switches stay visible but cannot change while push is not allowed (the stored choice is untouched).
    public var areSwitchesEnabled: Bool { phase == .ready && canReceivePush }

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
