import Foundation

/// The member's own account-level notification preferences (`users/{uid}/settings/notifications`). The adapter scopes
/// the document to the signed-in member; callers never supply a uid. A missing document loads as the registry defaults.
public protocol DIPNotificationPreferencesRepository: Sendable {
    func load() async throws -> DIPNotificationPreferences
    /// Writes only the given channel's map (every offered switch of that channel resolved) with a server `updatedAt`,
    /// so a push save never overwrites email switches and the reverse.
    func save(_ preferences: DIPNotificationPreferences, on channel: DIPNotificationChannel) async throws
}

extension DIPNotificationPreferencesRepository {
    /// Push save, kept so existing call sites compile unchanged.
    public func save(_ preferences: DIPNotificationPreferences) async throws {
        try await save(preferences, on: .push)
    }
}

/// What the settings screen needs to know about the system permission. `@MainActor` because the real adapter talks to
/// UIKit; tests fake it. Provisional and ephemeral count as authorized (`DIPPushPriming.canReceive`).
@MainActor
public protocol DIPNotificationPermissionProviding {
    func status() async -> DIPPushAuthorization
    /// Shows the system prompt (only possible while undetermined) and returns the new status.
    func turnOn() async -> DIPPushAuthorization
    /// Opens the app's notification settings in iOS Settings.
    func openSettings()
}
