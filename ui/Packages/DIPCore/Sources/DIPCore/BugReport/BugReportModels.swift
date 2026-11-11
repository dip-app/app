import Foundation

/// What kind of problem the member is reporting. `unspecified` is the default and is only sendable with a description.
public enum BugReportCategory: String, CaseIterable, Codable, Sendable {
    case bug, confusing, looksWrong, idea, unspecified

    /// The four selectable chips, in display order (unspecified is "no chip selected").
    public static let selectable: [BugReportCategory] = [.bug, .confusing, .looksWrong, .idea]

    public var title: String {
        switch self {
        case .bug: "Bug"
        case .confusing: "Confusing"
        case .looksWrong: "Looks wrong"
        case .idea: "Idea"
        case .unspecified: "Other"
        }
    }
}

/// Where the report was started. No ids of any screen content are ever included.
public enum BugReportSource: String, Codable, Sendable { case shake, profile }

/// The screen the member was on: a route kind only, never an event, photo or person id.
public enum BugReportScreen: String, CaseIterable, Codable, Sendable {
    case home, rewards, myEvents, profile, event, participants, album, challenge, other
}

/// App and device facts that help reproduce a problem. Deliberately small: no name, email, token, company or
/// location. `installId` is a random UUID created on first use; it is not derived from the account or device.
public struct BugReportDiagnostics: Codable, Equatable, Sendable {
    public var appVersion: String
    public var appBuild: String
    public var osVersion: String
    public var deviceModel: String
    public var locale: String
    public var screen: BugReportScreen
    public var installId: String

    public init(
        appVersion: String, appBuild: String, osVersion: String, deviceModel: String, locale: String,
        screen: BugReportScreen, installId: String
    ) {
        self.appVersion = appVersion; self.appBuild = appBuild; self.osVersion = osVersion
        self.deviceModel = deviceModel; self.locale = locale; self.screen = screen; self.installId = installId
    }
}

/// Everything the member typed or chose, as it will be sent. `reportId` is the idempotency key and the Firestore
/// document id, so a retry can never create a second report.
public struct BugReport: Codable, Equatable, Sendable, Identifiable {
    public var id: String { reportId }
    public var reportId: String
    /// Owner. Queue entries are filed and discarded per uid; the rules require it to equal `auth.uid`.
    public var uid: String
    public var category: BugReportCategory
    public var description: String
    public var source: BugReportSource
    public var screen: BugReportScreen
    public var diagnostics: BugReportDiagnostics?
    public var includesScreenshot: Bool
    public var createdAt: Date

    public init(
        reportId: String = UUID().uuidString.lowercased(), uid: String, category: BugReportCategory,
        description: String, source: BugReportSource, screen: BugReportScreen,
        diagnostics: BugReportDiagnostics?, includesScreenshot: Bool, createdAt: Date = Date()
    ) {
        self.reportId = reportId; self.uid = uid; self.category = category; self.description = description
        self.source = source; self.screen = screen; self.diagnostics = diagnostics
        self.includesScreenshot = includesScreenshot; self.createdAt = createdAt
    }

    /// Storage path of the screenshot, owner-scoped (matches storage.rules).
    public var screenshotPath: String? { includesScreenshot ? "bugReports/\(uid)/\(reportId).jpg" : nil }
}

/// The member's in-progress form. A pure value type so validation is unit-tested without UIKit.
public struct BugReportDraft: Equatable, Sendable {
    public static let maximumCharacters = 1_000
    public static let counterThreshold = 800
    public static let nearLimit = 950
    public static let minimumCharacters = 10

    public var category: BugReportCategory = .unspecified
    public var text: String = ""
    public var includesScreenshot = true
    public var includesDiagnostics = true

    public init() {}

    public var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    public var characterCount: Int { text.count }
    public var showsCounter: Bool { characterCount >= Self.counterThreshold }
    public var isNearLimit: Bool { characterCount >= Self.nearLimit }
    public var hasContent: Bool { category != .unspecified || !trimmed.isEmpty }

    /// Send needs a category or at least ten characters, which prevents empty reports.
    public var canSend: Bool {
        category != .unspecified || trimmed.count >= Self.minimumCharacters
    }

    /// Truncates to 1,000 characters (grapheme clusters) and also to 1,000 Unicode scalars, because firestore.rules
    /// counts code points: a string of multi-scalar emoji could otherwise pass here and fail there.
    /// Returns the limited text and whether anything was cut.
    public static func limited(_ text: String) -> (text: String, truncated: Bool) {
        var result = text.count > maximumCharacters ? String(text.prefix(maximumCharacters)) : text
        while result.unicodeScalars.count > maximumCharacters { result.removeLast() }
        return (result, result != text)
    }
}

public enum BugReportValidation {
    /// The same bounds as firestore.rules; a report that fails this is never sent.
    public static func isValid(_ report: BugReport) -> Bool {
        let description = report.description
        guard description.count <= BugReportDraft.maximumCharacters,
              description.unicodeScalars.count <= BugReportDraft.maximumCharacters else { return false }
        guard report.category != .unspecified
                || description.trimmingCharacters(in: .whitespacesAndNewlines).count >= BugReportDraft.minimumCharacters
        else { return false }
        guard UUID(uuidString: report.reportId) != nil, !report.uid.isEmpty else { return false }
        if let d = report.diagnostics {
            for value in [d.appVersion, d.appBuild, d.osVersion] where value.count > 32 { return false }
            if d.deviceModel.count > 40 || d.locale.count > 35 || UUID(uuidString: d.installId) == nil { return false }
        }
        return true
    }
}
