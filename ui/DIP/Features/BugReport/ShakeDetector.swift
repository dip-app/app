import DIPCore
import SwiftUI

#if canImport(UIKit)
    import UIKit

    extension Notification.Name {
        /// Posted on the main thread when the system reports a shake (`UIEvent.EventSubtype.motionShake`).
        static let dipDeviceDidShake = Notification.Name("org.dip-app.deviceDidShake")
    }

    /// The system shake gesture reaches the key window's responder chain. Overriding it here (rather than adding
    /// Core Motion) keeps one rule: whatever the system calls a shake, DIP calls a shake. No thresholds of our own.
    extension UIWindow {
        open override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
            super.motionEnded(motion, with: event)
            if motion == .motionShake {
                NotificationCenter.default.post(name: .dipDeviceDidShake, object: nil)
            }
        }
    }
#endif

/// Where the report flow is offered. The first release is for Debug and TestFlight testers; App Store builds
/// do not show the shake gesture or the Profile entry until the team decides to open it up.
enum BugReportAvailability {
    static var isAvailable: Bool {
        #if DEBUG
            return true
        #else
            // TestFlight builds carry a sandbox receipt; App Store builds carry a production receipt.
            return Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
        #endif
    }
}

#if canImport(UIKit)
    /// Screen capture and modal inspection for the report flow (UIKit-bound, so not part of the pure core).
    @MainActor
    enum ReportCapture {
        static var keyWindow: UIWindow? {
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .filter { $0.activationState == .foregroundActive }
                .flatMap(\.windows).first { $0.isKeyWindow }
        }

        /// True when any view controller is presented over the app: a system sheet, share sheet, photo picker, alert,
        /// Google sign-in or one of DIP's own sheets. A shake then does nothing.
        static func isAnotherModalUp() -> Bool {
            keyWindow?.rootViewController?.presentedViewController != nil
        }

        /// The screen as a JPEG, taken before the sheet opens. 1x scale and quality 0.7 keep it near 100 KB; it is
        /// re-encoded smaller if it would exceed the 400 KB Storage limit. Nil when a secure field is focused or the
        /// capture fails (the sheet then shows "No screenshot").
        static func capture() -> Data? {
            guard let window = keyWindow, !hasFocusedSecureField(in: window) else { return nil }
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: false)
            }
            for quality in [0.7, 0.5, 0.3] {
                if let data = image.jpegData(compressionQuality: quality), data.count <= 400 * 1024 { return data }
            }
            return nil
        }

        private static func hasFocusedSecureField(in view: UIView) -> Bool {
            if let field = view as? UITextField, field.isSecureTextEntry, field.isFirstResponder { return true }
            return view.subviews.contains { hasFocusedSecureField(in: $0) }
        }

        /// Facts for the diagnostics block. Reads only OS and bundle values, never account data.
        static func diagnostics(screen: BugReportScreen) -> BugReportDiagnostics {
            var system = utsname()
            uname(&system)
            let machine = withUnsafePointer(to: &system.machine) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
            }
            return BugReportDiagnosticsBuilder.make(
                infoDictionary: Bundle.main.infoDictionary ?? [:], osVersion: UIDevice.current.systemVersion,
                machineIdentifier: machine, localeIdentifier: Locale.current.identifier, screen: screen,
                installId: BugReportInstallID.current())
        }
    }
#endif
