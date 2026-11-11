import Foundation

/// Transport-free challenge submission values and rules (F3, V2-02). Mirrors docs/contracts/challenge-submissions.md:
/// the server owns status, points and counts; the client only shows them and sends the member's own content.

public enum DIPSubmissionStatus: String, Equatable, Sendable {
    /// Pending review (also right after a resubmission).
    case submitted
    case approved
    /// Sent back by an organizer with a reason; the member may resubmit while the window is open.
    case rejected
}

/// The member's own entry for one weekly theme (`challenges/{id}/submissions/{challengeId}_{uid}`).
public struct DIPSubmission: Equatable, Sendable {
    public var id: String
    public var status: DIPSubmissionStatus
    public var progress: Double
    public var caption: String
    /// Evidence object path (`.../submissions/{uid}/{slot}`), nil for a note-only entry.
    public var storagePath: String?
    public var attempt: Int
    public var reviewNote: String?
    public var pointsAwarded: Int
    public var updatedAt: Date?
    public init(id: String, status: DIPSubmissionStatus, progress: Double, caption: String = "", storagePath: String? = nil,
                attempt: Int = 1, reviewNote: String? = nil, pointsAwarded: Int = 0, updatedAt: Date? = nil) {
        self.id = id; self.status = status; self.progress = progress; self.caption = caption; self.storagePath = storagePath
        self.attempt = attempt; self.reviewNote = reviewNote; self.pointsAwarded = pointsAwarded; self.updatedAt = updatedAt
    }
    public var hasPhoto: Bool { storagePath != nil }
}

/// Limits shared with `gcp/storage.rules` and `submitChallengeV1`.
public enum DIPSubmissionPolicy {
    /// One create-only Storage object per slot: a member holds at most this many uploads per theme.
    public static let slots = 5
    public static let maxBytes = 10 * 1024 * 1024
    public static let maxCaption = 280
    public static let maxProgress = 10_000.0
    /// Long edge of the uploaded JPEG (same preparation as album photos).
    public static let maxPixelSize = 2048

    /// The touch control's step: whole numbers for whole goals (at most 100 detents), halves for small fractional
    /// goals, and about 20 detents for anything else. The smallest value is one step (progress must be above 0).
    public static func step(forGoal goal: Double) -> Double {
        guard goal.isFinite, goal > 0 else { return 1 }
        if goal.rounded() == goal { return max(1, (goal / 100).rounded(.up)) }
        if goal <= 20 { return 0.5 }
        return max(0.5, (goal / 20 * 2).rounded() / 2)
    }

    /// Snaps a value to the step grid within `step...goal` (the goal itself is always reachable).
    public static func clamp(_ value: Double, goal: Double) -> Double {
        let step = step(forGoal: goal)
        guard value.isFinite else { return step }
        let snapped = (value / step).rounded() * step
        return min(goal, max(step, snapped))
    }

    public static func submissionID(challengeID: String, uid: String) -> String { "\(challengeID)_\(uid)" }

    public static func evidencePath(companyID: String, challengeID: String, uid: String, slot: Int) -> String {
        "companies/\(companyID)/challenges/\(challengeID)/submissions/\(uid)/\(slot)"
    }

    /// The slot named by the last path component, or nil for a missing or malformed path.
    public static func slot(of path: String?) -> Int? {
        guard let last = path?.split(separator: "/").last, let slot = Int(last), String(slot) == last, (0..<slots).contains(slot) else { return nil }
        return slot
    }

    /// Lowest slot not in `used` (slots are create-only, so a new photo always needs a new one).
    public static func freeSlot(used: Set<Int>) -> Int? { (0..<slots).first { !used.contains($0) } }
}

public enum DIPSubmissionIssue: Equatable, Sendable {
    case progressMissing
    case progressInvalid
    case progressTooHigh(goalText: String)
    case captionTooLong
    /// Shown inline beside the field that needs attention.
    public var message: String {
        switch self {
        case .progressMissing: "Enter how much you did."
        case .progressInvalid: "Enter a number greater than 0."
        case .progressTooHigh(let goal): "That’s more than this week’s goal (\(goal))."
        case .captionTooLong: "Keep your note to \(DIPSubmissionPolicy.maxCaption) characters."
        }
    }
}

/// What the member typed. Pure value so validation is testable without UI.
public struct DIPSubmissionDraft: Equatable, Sendable {
    public var progressText: String
    public var caption: String
    public init(progressText: String = "", caption: String = "") { self.progressText = progressText; self.caption = caption }

    /// Accepts "3", "3.5" and "3,5"; nil when it is not a finite number.
    public var progress: Double? {
        let text = progressText.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: ".")
        guard !text.isEmpty, let value = Double(text), value.isFinite else { return nil }
        return value
    }

    public var trimmedCaption: String { caption.trimmingCharacters(in: .whitespacesAndNewlines) }
    public var captionCount: Int { caption.count }

    public func issues(goal: Double, goalText: String) -> [DIPSubmissionIssue] {
        var found: [DIPSubmissionIssue] = []
        if progressText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { found.append(.progressMissing) }
        else if let progress {
            if progress <= 0 { found.append(.progressInvalid) } else if progress > goal { found.append(.progressTooHigh(goalText: goalText)) }
        } else { found.append(.progressInvalid) }
        if trimmedCaption.count > DIPSubmissionPolicy.maxCaption { found.append(.captionTooLong) }
        return found
    }

    public func isValid(goal: Double, goalText: String) -> Bool { issues(goal: goal, goalText: goalText).isEmpty }

    /// A draft that starts from an existing entry (edit or resubmit).
    public init(from submission: DIPSubmission) {
        self.init(progressText: DIPSubmissionDraft.format(submission.progress), caption: submission.caption)
    }

    public static func format(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(format: "%g", value)
    }
}

/// What the "Your submission" section shows for the current theme window and entry.
public enum DIPSubmissionState: Equatable, Sendable {
    /// The window has not started.
    case upcoming
    /// Open window, no entry yet.
    case notStarted
    /// Window over and the member never entered.
    case missed
    /// Waiting for an organizer; the member may still edit while the window is open.
    case pending(DIPSubmission, canEdit: Bool)
    case approved(DIPSubmission)
    /// Sent back; `canResubmit` is false once the window has ended.
    case rejected(DIPSubmission, canResubmit: Bool)

    public static func state(phase: DIPChallengePhase?, submission: DIPSubmission?) -> DIPSubmissionState {
        // A theme without a window (the onboarding demo) behaves as open.
        let open = phase == nil || phase == .active
        guard let submission else {
            switch phase {
            case .upcoming?: return .upcoming
            case .ended?: return .missed
            default: return .notStarted
            }
        }
        switch submission.status {
        case .approved: return .approved(submission)
        case .submitted: return .pending(submission, canEdit: open)
        case .rejected: return .rejected(submission, canResubmit: open)
        }
    }

    /// The pressable action, if any (solid button).
    public var actionTitle: String? {
        switch self {
        case .notStarted: "Add your entry"
        case .pending(_, let canEdit): canEdit ? "Edit entry" : nil
        case .rejected(_, let canResubmit): canResubmit ? "Update and resubmit" : nil
        case .upcoming, .missed, .approved: nil
        }
    }

    /// Short informational label (outline pill).
    public var statusLabel: String {
        switch self {
        case .upcoming: "Not open yet"
        case .notStarted: "Not started"
        case .missed: "Closed"
        case .pending: "Waiting for review"
        case .approved: "Approved"
        case .rejected: "Needs changes"
        }
    }

    public var detail: String {
        switch self {
        case .upcoming: "You can add your entry once this theme starts."
        case .notStarted: "Add a number, a short note and optionally a photo."
        case .missed: "This theme has ended, so entries are closed."
        case .pending(_, let canEdit): canEdit ? "An organizer will review it. You can still change it until the week ends." : "An organizer will review it."
        case .approved(let submission): submission.pointsAwarded > 0 ? "You earned +\(submission.pointsAwarded) points." : "Approved. Thanks for taking part."
        case .rejected(let submission, let canResubmit):
            [submission.reviewNote.map { "Organizer note: \($0)" }, canResubmit ? "Update your entry and send it again." : "This theme has ended."]
                .compactMap { $0 }.joined(separator: " ")
        }
    }

    public var submission: DIPSubmission? {
        switch self {
        case .pending(let s, _), .approved(let s), .rejected(let s, _): s
        default: nil
        }
    }
}

/// Failures the member can act on, mapped from `submitChallengeV1` reasons and SDK errors in the Data layer.
public enum DIPSubmissionFailure: Error, Equatable, Sendable {
    case closed, uploadDenied, notStarted, locked, invalidInput, invalidImage, tooLarge, noSlotsLeft, notMember, unauthenticated, offline, unknown

    public var message: String {
        switch self {
        case .closed: "This theme has ended, so entries are closed."
        case .uploadDenied: "Your photo couldn’t be uploaded. Try again later, or send your entry without it."
        case .notStarted: "This theme hasn’t started yet."
        case .locked: "This entry was already approved, so it can’t be changed."
        case .invalidInput: "Check your entry and try again."
        case .invalidImage: "This photo couldn’t be used. Choose another one."
        case .tooLarge: "This photo is too large to upload."
        case .noSlotsLeft: "You’ve used all \(DIPSubmissionPolicy.slots) photo uploads for this theme. Remove the photo and send a note only."
        case .notMember: "Only members of this company can add an entry."
        case .unauthenticated: "Please sign in again."
        case .offline: "You’re offline. Check your connection and try again."
        case .unknown: "Your entry couldn’t be sent. Try again."
        }
    }

    /// Whether pressing the same action again could succeed without changing anything.
    public var isRetryable: Bool { self == .offline || self == .unknown }
}

public enum DIPSubmissionCopy {
    public static let sectionTitle = "Your entry"
    public static let sheetIntro = "How much did you do? A note and a photo are optional."
    public static let sheetTitle = "ADD YOUR ENTRY"
    public static let explain = "Tell us how much you did, add a short note and optionally a photo. An organizer reviews every entry before points are awarded."
    public static let loadFailure = "Couldn’t load your entry."
    public static let photoRules = "JPEG, PNG or HEIC. We resize it to fit."
    public static func opensUntil(_ day: String) -> String { "Entries close \(day)" }
}
