import Foundation

/// The languages the server writes a member's emails and pushes in (`users/{uid}.locale`, docs/design/backend-i18n.md).
public enum MemberLanguage: String, Equatable, Sendable, CaseIterable {
    case en, es

    /// The app's effective language from `Bundle.preferredLocalizations.first`. Spanish and its regional variants
    /// (`es`, `es-419`, `es_MX`) are `es`; anything else, the Klingon demo locale included, is `en`.
    public init(appLocalization: String?) {
        let code = appLocalization?.split(whereSeparator: { $0 == "-" || $0 == "_" }).first?.lowercased()
        self = code == "es" ? .es : .en
    }

    /// The stored profile value. Absent or unknown means English, like the server's `localeOrDefault`.
    public init(stored: String?) {
        self = stored == MemberLanguage.es.rawValue ? .es : .en
    }
}

/// `setMyLocaleV1` for the signed-in caller. The server derives the uid and tenant from the auth; nothing else is sent.
@MainActor public protocol MemberLocaleRepository: AnyObject {
    func setMyLocale(_ language: MemberLanguage) async throws
}

/// Keeps the member's server-side language in step with the app language, so emails and pushes match the app.
/// Runs on sign-in and when the app becomes active. It calls the server only when the app language differs from the
/// stored one, at most once per member and language in a launch. It shows nothing and never throws: a failure is retried
/// at the next launch. It logs nothing.
@MainActor public final class MemberLocaleSync {
    private let repository: (any MemberLocaleRepository)?
    private let appLanguage: () -> MemberLanguage
    /// "uid|language" pairs already sent (or tried) in this launch.
    private var attempted: Set<String> = []

    public init(repository: (any MemberLocaleRepository)?,
                appLanguage: @escaping () -> MemberLanguage = { MemberLanguage(appLocalization: Bundle.main.preferredLocalizations.first) }) {
        self.repository = repository
        self.appLanguage = appLanguage
    }

    /// Pass the current membership, or nil when signed out (then nothing happens). Returns whether a call was made.
    @discardableResult
    public func sync(_ context: MembershipContext?) async -> Bool {
        guard let repository, let context else { return false }
        let language = appLanguage()
        guard language != MemberLanguage(stored: context.profile.locale) else { return false }
        let key = context.uid + "|" + language.rawValue
        // Inserted before the await, so a foreground event during sign-in does not send twice.
        guard attempted.insert(key).inserted else { return false }
        do { try await repository.setMyLocale(language) } catch { /* silent: retried at the next launch */ }
        return true
    }
}
