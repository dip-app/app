import Foundation

/// Builds the diagnostics block from plain inputs, so the allow-list is testable without UIKit.
public enum BugReportDiagnosticsBuilder {
    public static func make(
        infoDictionary: [String: Any], osVersion: String, machineIdentifier: String, localeIdentifier: String,
        screen: BugReportScreen, installId: String
    ) -> BugReportDiagnostics {
        BugReportDiagnostics(
            appVersion: clamp(infoDictionary["CFBundleShortVersionString"] as? String ?? "unknown", 32),
            appBuild: clamp(infoDictionary["CFBundleVersion"] as? String ?? "unknown", 32),
            osVersion: "iOS " + clamp(osVersion, 27),
            deviceModel: clamp(machineIdentifier.isEmpty ? "unknown" : machineIdentifier, 40),
            locale: clamp(localeIdentifier, 35), screen: screen, installId: installId)
    }

    static func clamp(_ value: String, _ limit: Int) -> String {
        String(value.filter { !$0.isNewline }.prefix(limit))
    }

    /// Maps a route name from the app shell to the report's screen kind. Anything unexpected is `.other`, so an id
    /// that leaks into a route name can never reach the report.
    public static func screen(forRoute name: String) -> BugReportScreen {
        BugReportScreen(rawValue: name) ?? .other
    }
}

/// A random per-install id kept in UserDefaults (not Keychain, not derived from the account or device).
public enum BugReportInstallID {
    public static let key = "dip.bugReport.installId"
    public static func current(_ defaults: UserDefaults = .standard) -> String {
        if let existing = defaults.string(forKey: key), UUID(uuidString: existing) != nil { return existing }
        let created = UUID().uuidString.lowercased()
        defaults.set(created, forKey: key)
        return created
    }
}
