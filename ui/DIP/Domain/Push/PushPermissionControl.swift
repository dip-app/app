import DIPCore
import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// What the notifications center needs from the push client for its permission banner: read the system permission,
/// ask for it (only possible while undetermined) or open iOS Settings (after it was denied). It exists only when the
/// push client is enabled by flag; with the flag off the banner is never shown and nothing here runs.
struct PushPermissionControl {
    var status: @MainActor () async -> DIPPushAuthorization
    var turnOn: @MainActor () async -> DIPPushAuthorization
    var openSettings: @MainActor () -> Void

    @MainActor static func settingsOpener() -> @MainActor @Sendable () -> Void {
        { @MainActor @Sendable in
            #if canImport(UIKit)
            // The app's notification page when iOS has one, the app's general Settings page otherwise.
            let target = URL(string: UIApplication.openNotificationSettingsURLString) ?? URL(string: UIApplication.openSettingsURLString)
            if let target { UIApplication.shared.open(target) }
            #endif
        }
    }

    #if DEBUG
    /// `--notifications-push=undetermined|denied|authorized` (Debug, mock mode only): a banner or settings state for design review and UI tests; nothing is requested.
    @MainActor static func fixture() -> PushPermissionControl? {
        let value = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--notifications-push=") }
            .map { String($0.dropFirst("--notifications-push=".count)) }
        guard let value else { return nil }
        let state = StateBox(value == "denied" ? .denied : value == "authorized" ? .authorized : .notDetermined)
        return PushPermissionControl(
            status: { state.value },
            turnOn: { state.value = .authorized; return state.value },
            openSettings: {})
    }

    @MainActor private final class StateBox {
        var value: DIPPushAuthorization
        init(_ value: DIPPushAuthorization) { self.value = value }
    }
    #endif
}

/// Lets the notification settings screen (DIPPresentation) use the same permission seam as the notifications center.
struct PushPermissionProvider: DIPNotificationPermissionProviding {
    let control: PushPermissionControl
    func status() async -> DIPPushAuthorization { await control.status() }
    func turnOn() async -> DIPPushAuthorization { await control.turnOn() }
    func openSettings() { control.openSettings() }
}
