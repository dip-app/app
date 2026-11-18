import SwiftUI

/// Hidden developer/demo language switch (docs/design/ios-i18n.md). Members normally follow the iOS language, or pick
/// one in iOS Settings > DIP > Language. This override exists for demos and for languages iOS does not list there
/// (the Klingon demo locale `tlh`). It writes the per-app `AppleLanguages` preference, which Foundation reads at launch,
/// so the app must be relaunched to switch. Nothing is stored on the member profile.
enum DemoLanguage: String, CaseIterable, Identifiable {
    case system, english = "en", spanish = "es", klingon = "tlh"

    var id: String { rawValue }

    /// Endonyms: each language is shown in its own name, never translated.
    var title: String {
        switch self {
        case .system: String(localized: "demoLanguage.system", defaultValue: "System language", comment: "Hidden demo language menu: follow the iOS language")
        case .english: "English"
        case .spanish: "Español"
        case .klingon: "tlhIngan Hol"
        }
    }

    static let preferenceKey = "AppleLanguages"

    /// The override saved in this app's defaults, or `.system` when the app follows iOS.
    static func current(_ defaults: UserDefaults = .standard) -> DemoLanguage {
        guard defaults.persistentDomain(forName: Bundle.main.bundleIdentifier ?? "")?[preferenceKey] != nil,
              let code = defaults.stringArray(forKey: preferenceKey)?.first else { return .system }
        return DemoLanguage.allCases.first { $0 != .system && code.hasPrefix($0.rawValue) } ?? .system
    }

    /// Saves the override (or removes it for `.system`). Takes effect at the next launch.
    func apply(_ defaults: UserDefaults = .standard) {
        if self == .system { defaults.removeObject(forKey: Self.preferenceKey) } else { defaults.set([rawValue], forKey: Self.preferenceKey) }
    }
}

/// Long-press (2 s) on the modified view opens the demo language menu. Invisible: it adds no pixels.
struct DemoLanguageTrigger: ViewModifier {
    @State private var showsMenu = false
    @State private var pending: DemoLanguage?

    func body(content: Content) -> some View {
        content
            .onLongPressGesture(minimumDuration: 2) { showsMenu = true }
            .confirmationDialog(String(localized: "demoLanguage.title", defaultValue: "App language (demo)", comment: "Hidden demo language menu title"),
                                isPresented: $showsMenu, titleVisibility: .visible) {
                ForEach(DemoLanguage.allCases) { language in
                    Button(language == DemoLanguage.current() ? "✓ \(language.title)" : language.title) {
                        language.apply()
                        pending = language
                    }
                }
            }
            .alert(String(localized: "demoLanguage.relaunch.title", defaultValue: "Relaunch DIP", comment: "Alert after choosing a demo language"),
                   isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } })) {
                Button(String(localized: "demoLanguage.relaunch.ok", defaultValue: "OK", comment: "Dismisses the relaunch alert")) { pending = nil }
            } message: {
                Text(String(localized: "demoLanguage.relaunch.message", defaultValue: "Close DIP from the app switcher and open it again to use the new language.", comment: "Alert body after choosing a demo language"))
            }
    }
}

extension View {
    func demoLanguageTrigger() -> some View { modifier(DemoLanguageTrigger()) }
}
