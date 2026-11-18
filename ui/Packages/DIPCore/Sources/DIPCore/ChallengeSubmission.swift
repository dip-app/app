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
        case .progressMissing: String(localized: "submission.issue.progressMissing", defaultValue: "Enter how much you did.", bundle: .module, comment: "Entry form validation: amount empty")
        case .progressInvalid: String(localized: "submission.issue.progressInvalid", defaultValue: "Enter a number greater than 0.", bundle: .module, comment: "Entry form validation: amount not a positive number")
        case .progressTooHigh(let goal): String(localized: "submission.issue.progressTooHigh", defaultValue: "That’s more than this week’s goal (\(goal)).", bundle: .module, comment: "Entry form validation; %@ = goal text such as 10 miles")
        case .captionTooLong: String(localized: "submission.issue.captionTooLong", defaultValue: "Keep your note to \(DIPSubmissionPolicy.maxCaption) characters.", bundle: .module, comment: "Entry form validation; %lld = maximum note length")
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
        case .notStarted: String(localized: "submission.action.add", defaultValue: "Add your entry", bundle: .module, comment: "Button to add a challenge entry")
        case .pending(_, let canEdit): canEdit ? String(localized: "submission.action.edit", defaultValue: "Edit entry", bundle: .module, comment: "Button to edit a pending challenge entry") : nil
        case .rejected(_, let canResubmit): canResubmit ? String(localized: "submission.action.resubmit", defaultValue: "Update and resubmit", bundle: .module, comment: "Button to resubmit a challenge entry after changes were requested") : nil
        case .upcoming, .missed, .approved: nil
        }
    }

    /// Short informational label (outline pill).
    public var statusLabel: String {
        switch self {
        case .upcoming: String(localized: "submission.status.upcoming", defaultValue: "Not open yet", bundle: .module, comment: "Challenge entry status pill: theme has not started")
        case .notStarted: String(localized: "submission.status.notStarted", defaultValue: "Not started", bundle: .module, comment: "Challenge entry status pill: no entry yet")
        case .missed: String(localized: "submission.status.missed", defaultValue: "Closed", bundle: .module, comment: "Challenge entry status pill: entries closed")
        case .pending: String(localized: "submission.status.pending", defaultValue: "Waiting for review", bundle: .module, comment: "Challenge entry status pill: awaiting organizer review")
        case .approved: String(localized: "submission.status.approved", defaultValue: "Approved", bundle: .module, comment: "Challenge entry status pill: approved")
        case .rejected: String(localized: "submission.status.rejected", defaultValue: "Needs changes", bundle: .module, comment: "Challenge entry status pill: organizer asked for changes")
        }
    }

    public var detail: String {
        switch self {
        case .upcoming: String(localized: "submission.detail.upcoming", defaultValue: "You can add your entry once this theme starts.", bundle: .module, comment: "Challenge entry detail: theme not started")
        case .notStarted: String(localized: "submission.detail.notStarted", defaultValue: "Add a number, a short note and optionally a photo.", bundle: .module, comment: "Challenge entry detail: no entry yet")
        case .missed: String(localized: "submission.detail.missed", defaultValue: "This theme has ended, so entries are closed.", bundle: .module, comment: "Challenge entry detail: missed")
        case .pending(_, let canEdit): canEdit ? String(localized: "submission.detail.pendingEditable", defaultValue: "An organizer will review it. You can still change it until the week ends.", bundle: .module, comment: "Challenge entry detail: pending, still editable") : String(localized: "submission.detail.pending", defaultValue: "An organizer will review it.", bundle: .module, comment: "Challenge entry detail: pending, locked")
        case .approved(let submission): submission.pointsAwarded > 0 ? String(localized: "submission.detail.approvedPoints", defaultValue: "You earned +\(submission.pointsAwarded) points.", bundle: .module, comment: "Challenge entry detail: approved; %lld = points earned") : String(localized: "submission.detail.approved", defaultValue: "Approved. Thanks for taking part.", bundle: .module, comment: "Challenge entry detail: approved without points")
        case .rejected(let submission, let canResubmit):
            switch (submission.reviewNote, canResubmit) {
            case (let note?, true):
                String(localized: "submission.detail.rejected.noteResubmit", defaultValue: "Organizer note: \(note) Update your entry and send it again.", bundle: .module, comment: "Challenge entry detail: changes requested; %@ = the organizer's note")
            case (let note?, false):
                String(localized: "submission.detail.rejected.noteEnded", defaultValue: "Organizer note: \(note) This theme has ended.", bundle: .module, comment: "Challenge entry detail: changes requested but the theme ended; %@ = the organizer's note")
            case (nil, true):
                String(localized: "submission.detail.rejected.resubmit", defaultValue: "Update your entry and send it again.", bundle: .module, comment: "Challenge entry detail: changes requested")
            case (nil, false):
                String(localized: "submission.detail.rejected.ended", defaultValue: "This theme has ended.", bundle: .module, comment: "Challenge entry detail: changes requested but the theme ended")
            }
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
        case .closed: String(localized: "submission.error.closed", defaultValue: "This theme has ended, so entries are closed.", bundle: .module, comment: "Entry error")
        case .uploadDenied: String(localized: "submission.error.uploadDenied", defaultValue: "Your photo couldn’t be uploaded. Try again later, or send your entry without it.", bundle: .module, comment: "Entry error")
        case .notStarted: String(localized: "submission.error.notStarted", defaultValue: "This theme hasn’t started yet.", bundle: .module, comment: "Entry error")
        case .locked: String(localized: "submission.error.locked", defaultValue: "This entry was already approved, so it can’t be changed.", bundle: .module, comment: "Entry error")
        case .invalidInput: String(localized: "submission.error.invalidInput", defaultValue: "Check your entry and try again.", bundle: .module, comment: "Entry error")
        case .invalidImage: String(localized: "submission.error.invalidImage", defaultValue: "This photo couldn’t be used. Choose another one.", bundle: .module, comment: "Entry error")
        case .tooLarge: String(localized: "submission.error.tooLarge", defaultValue: "This photo is too large to upload.", bundle: .module, comment: "Entry error")
        case .noSlotsLeft: String(localized: "submission.error.noSlotsLeft", defaultValue: "You’ve used all \(DIPSubmissionPolicy.slots) photo uploads for this theme. Remove the photo and send a note only.", bundle: .module, comment: "Entry error; %lld = number of allowed photo uploads")
        case .notMember: String(localized: "submission.error.notMember", defaultValue: "Only members of this company can add an entry.", bundle: .module, comment: "Entry error")
        case .unauthenticated: String(localized: "submission.error.unauthenticated", defaultValue: "Please sign in again.", bundle: .module, comment: "Entry error")
        case .offline: String(localized: "submission.error.offline", defaultValue: "You’re offline. Check your connection and try again.", bundle: .module, comment: "Entry error")
        case .unknown: String(localized: "submission.error.unknown", defaultValue: "Your entry couldn’t be sent. Try again.", bundle: .module, comment: "Entry error")
        }
    }

    /// Whether pressing the same action again could succeed without changing anything.
    public var isRetryable: Bool { self == .offline || self == .unknown }
}

public enum DIPSubmissionCopy {
    public static var sectionTitle: String { String(localized: "submission.copy.sectionTitle", defaultValue: "Your entry", bundle: .module, comment: "Challenge details section title") }
    public static var sheetIntro: String { String(localized: "submission.copy.sheetIntro", defaultValue: "How much did you do? A note and a photo are optional.", bundle: .module, comment: "Entry sheet intro") }
    public static var sheetTitle: String { String(localized: "submission.copy.sheetTitle", defaultValue: "ADD YOUR ENTRY", bundle: .module, comment: "Entry sheet title (uppercase eyebrow)") }
    public static var explain: String { String(localized: "submission.copy.explain", defaultValue: "Tell us how much you did, add a short note and optionally a photo. An organizer reviews every entry before points are awarded.", bundle: .module, comment: "Entry sheet explanation") }
    public static var loadFailure: String { String(localized: "submission.copy.loadFailure", defaultValue: "Couldn’t load your entry.", bundle: .module, comment: "Error loading the member entry") }
    public static var photoRules: String { String(localized: "submission.copy.photoRules", defaultValue: "JPEG, PNG or HEIC. We resize it to fit.", bundle: .module, comment: "Entry sheet photo hint") }
    public static func opensUntil(_ day: String) -> String { String(localized: "submission.copy.opensUntil", defaultValue: "Entries close \(day)", bundle: .module, comment: "Challenge note; %@ = last day entries are accepted, e.g. Sun, Nov 15") }
}
