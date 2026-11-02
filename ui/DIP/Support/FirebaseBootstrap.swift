import Foundation
@preconcurrency import FirebaseAppCheck
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseCore
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseFunctions
@preconcurrency import GoogleSignIn

/// Single place where the app attaches to Firebase (ADR 0007).
///
/// Firebase is configured only when a local, uncommitted
/// `ui/DIP/Support/GoogleService-Info.plist` is present at project generation.
/// Without it the app reports `.notConfigured` and Debug builds can fall back to
/// the in-memory preview repository. Nothing here embeds project IDs or keys.
///
/// Debug builds route to the local emulators (Auth 9099, Firestore 8080,
/// Functions 5001 on 127.0.0.1) when the scheme sets `DIP_USE_EMULATORS=1`.
/// Never point a development build at production by accident: emulator routing
/// is opt-in and Release builds ignore it.
///
/// App Check (required by resolveMembershipV1 outside the emulator) is installed before
/// `FirebaseApp.configure()`: Debug builds and the Simulator use the debug provider, which
/// prints a debug token to the Xcode console once; register it in Firebase console ->
/// App Check -> Apps -> Manage debug tokens. Release device builds use App Attest.
enum FirebaseBootstrap {
    enum Status: Equatable {
        case configured(usingEmulators: Bool)
        case notConfigured
    }

    @MainActor private(set) static var status: Status = .notConfigured

    /// Call once at launch, before creating any repository or listener.
    @MainActor @discardableResult
    static func configureIfAvailable(bundle: Bundle = .main, environment: [String: String] = ProcessInfo.processInfo.environment) -> Status {
        if FirebaseApp.app() != nil { return status }
        guard bundle.path(forResource: "GoogleService-Info", ofType: "plist") != nil else {
            status = .notConfigured
            return status
        }
        AppCheck.setAppCheckProviderFactory(DIPAppCheckProviderFactory())
        FirebaseApp.configure()
        var usingEmulators = false
        #if DEBUG
        if environment["DIP_USE_EMULATORS"] == "1" {
            let host = environment["DIP_EMULATOR_HOST"] ?? "127.0.0.1"
            Auth.auth().useEmulator(withHost: host, port: 9099)
            let settings = Firestore.firestore().settings
            settings.host = "\(host):8080"
            settings.isSSLEnabled = false
            settings.cacheSettings = MemoryCacheSettings()
            Firestore.firestore().settings = settings
            Functions.functions(region: FirebaseAccountsRepository.region).useEmulator(withHost: host, port: 5001)
            usingEmulators = true
        }
        #endif
        status = .configured(usingEmulators: usingEmulators)
        return status
    }

    /// The real accounts repository, or nil when Firebase is not configured.
    @MainActor static func makeAccountsRepository() -> FirebaseAccountsRepository? {
        guard case .configured = status else { return nil }
        return FirebaseAccountsRepository(
            auth: Auth.auth(),
            firestore: Firestore.firestore(),
            functions: Functions.functions(region: FirebaseAccountsRepository.region)
        )
    }

    /// Completes the Google sign-in redirect. Wire to `.onOpenURL` in the app.
    @MainActor @discardableResult
    static func handle(url: URL) -> Bool {
        GIDSignIn.sharedInstance.handle(url)
    }
}

/// App Attest on real devices in Release; the debug provider for Debug and the Simulator,
/// where App Attest is unavailable. No tokens or secrets live in source.
///
/// Release device builds additionally need the App Attest capability, which requires a paid
/// Apple Developer Program team (free Personal Teams cannot sign it). When the team has one,
/// add to the DIP target in ui/project.yml:
///   entitlements: { path: Config/DIP.entitlements,
///     properties: { com.apple.developer.devicecheck.appattest-environment: production } }
/// and register App Attest (with the Team ID) in Firebase console -> App Check.
final class DIPAppCheckProviderFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> (any AppCheckProvider)? {
        #if DEBUG || targetEnvironment(simulator)
        return AppCheckDebugProvider(app: app)
        #else
        return AppAttestProvider(app: app)
        #endif
    }
}
