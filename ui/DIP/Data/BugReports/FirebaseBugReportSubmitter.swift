import DIPCore
import Foundation
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseStorage

/// Maps a report to the `bugReports/{reportId}` document accepted by `firestore.rules`. Pure, so the field list
/// is unit-tested against the rules' allow-list. `createdAt` is a server timestamp: the rules require
/// `createdAt == request.time`. Nothing here reads a name, email, token or company.
enum BugReportDocument {
    static func data(for report: BugReport, screenshotBytes: Int?) -> [String: Any] {
        var data: [String: Any] = [
            "uid": report.uid,
            "category": report.category.rawValue,
            "description": report.description,
            "source": report.source.rawValue,
            "screen": report.screen.rawValue,
            "createdAt": FieldValue.serverTimestamp(),
        ]
        if let d = report.diagnostics {
            data["diagnostics"] = [
                "appVersion": d.appVersion, "appBuild": d.appBuild, "osVersion": d.osVersion,
                "deviceModel": d.deviceModel, "locale": d.locale, "screen": d.screen.rawValue, "installId": d.installId,
            ]
        }
        if let path = report.screenshotPath, let bytes = screenshotBytes {
            data["screenshotPath"] = path
            data["screenshotBytes"] = bytes
        }
        return data
    }

    /// Firestore and Storage failures, reduced to what the UI distinguishes.
    static func submitError(_ error: Error) -> BugReportSubmitError {
        let ns = error as NSError
        if ns.domain == FirestoreErrorDomain, let code = FirestoreErrorCode.Code(rawValue: ns.code) {
            switch code {
            case .unavailable, .deadlineExceeded, .cancelled: return .offline
            case .resourceExhausted: return .rateLimited
            // Create-only rules also answer a repeat of an already stored report with permission-denied; the
            // outbox treats `.rejected` as final, which is right for both cases.
            case .permissionDenied, .unauthenticated, .invalidArgument, .failedPrecondition: return .rejected
            default: return .failed
            }
        }
        if ns.domain == StorageErrorDomain, let code = StorageErrorCode(rawValue: ns.code) {
            switch code {
            case .retryLimitExceeded: return .offline
            case .unauthorized, .unauthenticated, .quotaExceeded: return .rejected
            default: break
            }
        }
        if ns.domain == NSURLErrorDomain {
            let offline: Set<Int> = [
                NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut,
                NSURLErrorCannotConnectToHost, NSURLErrorDataNotAllowed, NSURLErrorCannotFindHost,
            ]
            if offline.contains(ns.code) { return .offline }
        }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError, underlying.domain == NSURLErrorDomain,
           [NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut].contains(underlying.code) {
            return .offline
        }
        return .failed
    }
}

/// Firestore + Storage adapter. The screenshot (if any) is uploaded first to `bugReports/{uid}/{reportId}.jpg`
/// (owner-only, size and type limited by storage.rules), then the report document is created. Uploads may be
/// repeated (the same path is overwritten); the document create is idempotent by id.
struct FirebaseBugReportSubmitter: BugReportSubmitting {
    private let firestore: Firestore
    private let storage: Storage

    init(firestore: Firestore = .firestore(), storage: Storage = .storage()) {
        self.firestore = firestore
        self.storage = storage
    }

    func submit(_ report: BugReport, screenshot: Data?) async throws {
        guard let current = Auth.auth().currentUser?.uid, current == report.uid else { throw BugReportSubmitError.rejected }
        guard BugReportValidation.isValid(report) else { throw BugReportSubmitError.rejected }
        do {
            var uploaded: Int?
            if let path = report.screenshotPath, let screenshot {
                let metadata = StorageMetadata()
                metadata.contentType = "image/jpeg"
                _ = try await storage.reference(withPath: path).putDataAsync(screenshot, metadata: metadata)
                uploaded = screenshot.count
            }
            try await firestore.collection("bugReports").document(report.reportId)
                .setData(BugReportDocument.data(for: report, screenshotBytes: uploaded))
        } catch {
            throw BugReportDocument.submitError(error)
        }
    }
}
