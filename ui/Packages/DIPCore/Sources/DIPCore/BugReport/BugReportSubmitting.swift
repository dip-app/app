import Foundation

/// Why a submission did not reach the team. The UI picks its message and Bar from this.
public enum BugReportSubmitError: Error, Equatable, Sendable {
    /// No connection (or the request timed out). The report is queued and retried later.
    case offline
    /// Too many reports; the draft is kept and the Bar offers Close.
    case rateLimited
    /// The server refused the report (rules / validation). Retrying the same content will not help.
    case rejected
    /// Anything else; the draft is kept and the member can try again.
    case failed
}

/// Delivers one report (and its optional JPEG screenshot). Implementations must be idempotent per `reportId`.
/// Adapters: `MockBugReportSubmitter` (previews, tests) and the Firestore + Storage adapter in the app target.
public protocol BugReportSubmitting: Sendable {
    func submit(_ report: BugReport, screenshot: Data?) async throws
}

/// In-memory submitter for previews and tests. Not a production endpoint.
public actor MockBugReportSubmitter: BugReportSubmitting {
    public enum Behavior: Sendable, Equatable { case succeed, offline, rateLimited, rejected, fail, failOnce }

    public private(set) var submitted: [BugReport] = []
    public private(set) var screenshots: [String: Data] = [:]
    public private(set) var attempts = 0
    public var behavior: Behavior
    private let delay: Duration

    public init(behavior: Behavior = .succeed, delay: Duration = .milliseconds(600)) {
        self.behavior = behavior
        self.delay = delay
    }

    public func setBehavior(_ behavior: Behavior) { self.behavior = behavior }

    public func submit(_ report: BugReport, screenshot: Data?) async throws {
        attempts += 1
        try? await Task.sleep(for: delay)
        switch behavior {
        case .succeed: break
        case .offline: throw BugReportSubmitError.offline
        case .rateLimited: throw BugReportSubmitError.rateLimited
        case .rejected: throw BugReportSubmitError.rejected
        case .fail: throw BugReportSubmitError.failed
        case .failOnce:
            behavior = .succeed
            throw BugReportSubmitError.failed
        }
        if !submitted.contains(where: { $0.reportId == report.reportId }) { submitted.append(report) }
        if let screenshot { screenshots[report.reportId] = screenshot }
    }
}
