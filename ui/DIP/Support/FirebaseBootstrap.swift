import Foundation
import DIPAccounts
import DIPCore
@preconcurrency import FirebaseAppCheck
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseCore
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseFunctions
@preconcurrency import FirebaseStorage
@preconcurrency import GoogleSignIn

/// Single place where the app attaches to Firebase (ADR 0007).
///
/// Firebase is configured only when a local, uncommitted
/// `ui/DIP/Support/GoogleService-Info.plist` is present at project generation.
/// Without it the app reports `.notConfigured` and Debug builds can fall back to
/// the in-memory preview repository. Nothing here embeds project IDs or keys.
///
/// Debug builds route to the local emulators (Auth 9099, Firestore 8080,
/// Functions 5001, Storage 9199 on 127.0.0.1) when the scheme sets `DIP_USE_EMULATORS=1`.
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

    /// The signed-in Google account's photo, enlarged for the profile page. Empty when unavailable.
    @MainActor static func oauthPhotoURL() -> String {
        guard FirebaseApp.app() != nil, let url = Auth.auth().currentUser?.photoURL else { return "" }
        // Google serves a 96px thumbnail by default; ask for a sharper one.
        return url.absoluteString.replacingOccurrences(of: "=s96-c", with: "=s400-c")
    }

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
            Storage.storage().useEmulator(withHost: host, port: 9199)
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

    /// Member events share the configured account SDKs and emulator routing.
    @MainActor static func makeMemberEventsRepository(context: MembershipContext) -> MemberEventsRepository? {
        guard case .configured = status else { return nil }
        return FirebaseEventReadSource.repository(context: context, auth: Auth.auth(), firestore: Firestore.firestore())
    }

    /// Weekly-theme (challenge) reads for the member Home share the configured SDKs and emulator routing.
    @MainActor static func makeMemberChallengesRepository(context: MembershipContext) -> MemberChallengesRepository? {
        guard case .configured = status else { return nil }
        return FirebaseChallengeReadSource.repository(context: context, auth: Auth.auth(), firestore: Firestore.firestore())
    }

    /// Challenge submissions (Storage evidence, submitChallengeV1, own submission reads) share the configured SDKs.
    @MainActor static func makeSubmissionSource() -> (any SubmissionSource)? {
        guard case .configured = status else { return nil }
        return FirebaseSubmissionSource(firestore: Firestore.firestore(),
                                        functions: Functions.functions(region: FirebaseAccountsRepository.region),
                                        storage: Storage.storage())
    }

    /// RSVP (setRsvpV1) and participation reads share the configured SDKs and emulator routing.
    @MainActor static func makeParticipationSource() -> (any ParticipationSource)? {
        guard case .configured = status else { return nil }
        return FirebaseParticipationSource(firestore: Firestore.firestore(),
                                           functions: Functions.functions(region: FirebaseAccountsRepository.region))
    }

    /// Coworker invitations (`sendInviteV1`, `respondToInviteV1`, `listCoworkersV1` and the invite listeners) share the configured SDKs.
    @MainActor static func makeInvitesRepository(context: MembershipContext) -> (any DIPInvitesRepository)? {
        guard case .configured = status else { return nil }
        return FirebaseInvitesRepository(firestore: Firestore.firestore(),
                                         functions: Functions.functions(region: FirebaseAccountsRepository.region),
                                         scope: EventReadScope(uid: context.uid, companyID: context.companyID))
    }

    /// The member's own in-app notifications (users/{uid}/notifications): live list, unread count and isRead-only writes.
    @MainActor static func makeNotificationsRepository(context: MembershipContext) -> (any DIPNotificationsRepository)? {
        guard case .configured = status else { return nil }
        return FirebaseNotificationsRepository(firestore: Firestore.firestore(), uid: context.uid)
    }

    /// Bug reports (shake to report) go to Firestore `bugReports` and Storage `bugReports/{uid}/…`.
    @MainActor static func makeBugReportSubmitter() -> (any BugReportSubmitting)? {
        guard case .configured = status else { return nil }
        return FirebaseBugReportSubmitter(firestore: Firestore.firestore(), storage: Storage.storage())
    }

    /// Event photo albums (Storage uploads, finalizeEventPhotoV1, album/comment reads) share the configured SDKs.
    @MainActor static func makePhotoAlbumSource() -> (any PhotoAlbumSource)? {
        guard case .configured = status else { return nil }
        return FirebasePhotoAlbumSource(firestore: Firestore.firestore(),
                                        functions: Functions.functions(region: FirebaseAccountsRepository.region),
                                        storage: Storage.storage())
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
