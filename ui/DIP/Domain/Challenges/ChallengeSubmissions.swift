import DIPCore
import Foundation
import SwiftUI

/// Live submission reads and writes for one membership scope (docs/contracts/challenge-submissions.md).
/// The client never sets status or points: `submit` sends the member's own content and the server answers.
/// `stop()` removes every listener and cancels uploads.
@MainActor protocol SubmissionSource: AnyObject {
    /// The member's own entry for the theme, updated live. nil = no entry yet.
    func observe(scope: ChallengeReadScope, challengeID: String) -> AsyncThrowingStream<DIPSubmission?, Error>
    /// Uploads one evidence JPEG into the create-only slot; progress in 0...1. `.slotOccupied` means another,
    /// different upload already holds the slot, so the caller tries the next one.
    func uploadEvidence(scope: ChallengeReadScope, challengeID: String, slot: Int, jpeg: Data,
                        progress: @escaping @Sendable (Double) -> Void) async throws -> AlbumUploadOutcome
    /// submitChallengeV1. Idempotent for identical content, so a retry never double-submits.
    func submit(scope: ChallengeReadScope, challengeID: String, progress: Double, caption: String, storagePath: String?) async throws
    func stop()
}

/// What the theme page needs to build its submission model: the tenant scope and a lazily created source
/// (the SDK-backed source is never created while rendering, only when the page appears).
struct ChallengeSubmissionContext {
    let scope: ChallengeReadScope
    let makeSource: @MainActor () -> any SubmissionSource
}

extension EnvironmentValues {
    /// Nil (the default) means the page is read-only, as in the standalone previews.
    @Entry var challengeSubmissionContext: ChallengeSubmissionContext? = nil
}
