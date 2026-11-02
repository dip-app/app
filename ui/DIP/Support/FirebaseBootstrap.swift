import Foundation
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
