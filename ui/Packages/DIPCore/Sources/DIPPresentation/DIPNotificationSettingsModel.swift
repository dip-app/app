import DIPCore
import Foundation
import Observation

/// Profile > Notifications: the system permission, one switch per push category, and the per-activity explainer.
/// Toggling is optimistic: the switch moves at once, one write per change (saves run in order, each writes the latest
/// state), and a failed write puts that switch back and shows a message the member can retry.
@MainActor @Observable
public final class DIPNotificationSettingsModel {
    public enum Phase: Equatable, Sendable { case loading, ready, failed(String) }

    /// Screen sections in order. The email workstream adds its case here; push is the only one for now.
    public enum Section: String, CaseIterable, Sendable {
        case push

        public var title: String {
            switch self { case .push: "Alert types" }
        }
        public var channel: DIPNotificationChannel {
            switch self { case .push: .push }
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
    public static let perActivityMessage = "Each activity has its own bell in its chat. It controls chat, change and reminder alerts for that activity and overrides the switches here."
    public static let disabledFootnote = "Turn on push notifications above to change these."
    public static let saveFailureMessage = "Couldn’t save that change. Check your connection and try again."
    public static let loadFailureMessage = "Couldn’t load your notification settings. Check your connection and try again."

    public private(set) var phase: Phase = .loading
    public private(set) var authorization: DIPPushAuthorization = .notDetermined
    public private(set) var preferences: DIPNotificationPreferences = .defaults
    public private(set) var saveError: String?

    @ObservationIgnored private let repository: any DIPNotificationPreferencesRepository
    @ObservationIgnored private let permission: any DIPNotificationPermissionProviding
    @ObservationIgnored private var saveChain: Task<Void, Never>?
    @ObservationIgnored private var failedChange: (category: DIPNotificationCategory, value: Bool)?

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
        case .authorized, .provisional, .ephemeral: "Push notifications: On"
        case .denied: "Notifications are off in iOS Settings"
        case .notDetermined: "Push notifications: Off"
        }
    }

    public var masterDetail: String? {
        switch authorization {
        case .authorized, .provisional, .ephemeral: nil
        case .denied: "Allow notifications for DIP in iOS Settings to get alerts on this phone."
        case .notDetermined: "Get alerts on this phone for the activities you join."
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
        case .turnOn: "Turn on"
        case .openSettings: "Open iOS Settings"
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

    public func rows(in section: Section) -> [Row] {
        DIPNotificationCategory.offered(on: section.channel).map {
            Row(category: $0, title: $0.title, summary: $0.summary, isOn: preferences.isEnabled($0, on: section.channel))
        }
    }

    public var pushRows: [Row] { rows(in: .push) }

    // MARK: Toggling

    public func toggle(_ category: DIPNotificationCategory, to value: Bool) async {
        guard areSwitchesEnabled, preferences.isEnabled(category, on: .push) != value else { return }
        saveError = nil
        failedChange = nil
        preferences = preferences.setting(category, on: .push, to: value)
        let previous = saveChain
        let task = Task { [weak self] in
            await previous?.value
            await self?.persist(category, from: !value, to: value)
        }
        saveChain = task
        await task.value
    }

    /// Re-applies the change that just failed.
    public func retryFailedChange() async {
        guard let failedChange else { return }
        await toggle(failedChange.category, to: failedChange.value)
    }

    public func dismissSaveError() { saveError = nil; failedChange = nil }

    private func persist(_ category: DIPNotificationCategory, from before: Bool, to value: Bool) async {
        do { try await repository.save(preferences) }
        catch {
            // Put only this switch back; other switches the member has since moved keep their state.
            if preferences.isEnabled(category, on: .push) == value {
                preferences = preferences.setting(category, on: .push, to: before)
            }
            saveError = Self.saveFailureMessage
            failedChange = (category, value)
        }
    }
}
