import Foundation

/// A queued report waiting for a connection.
public struct QueuedBugReport: Codable, Equatable, Sendable {
    public var report: BugReport
    public var attempts: Int
    public var nextAttemptAt: Date
    public var hasScreenshot: Bool
}

/// Persistence for the outbox. Two implementations: in memory (tests) and files in Caches (the app).
public protocol BugReportQueueStore: Sendable {
    func load() -> [QueuedBugReport]
    func save(_ items: [QueuedBugReport])
    func screenshot(for reportId: String) -> Data?
    func saveScreenshot(_ data: Data, for reportId: String)
    func removeScreenshot(for reportId: String)
}

public final class InMemoryBugReportQueueStore: BugReportQueueStore, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [QueuedBugReport] = []
    private var shots: [String: Data] = [:]
    public init() {}
    public func load() -> [QueuedBugReport] { lock.withLock { items } }
    public func save(_ items: [QueuedBugReport]) { lock.withLock { self.items = items } }
    public func screenshot(for reportId: String) -> Data? { lock.withLock { shots[reportId] } }
    public func saveScreenshot(_ data: Data, for reportId: String) { lock.withLock { shots[reportId] = data } }
    public func removeScreenshot(for reportId: String) { lock.withLock { _ = shots.removeValue(forKey: reportId) } }
}

/// JSON index plus one JPEG per report, in a directory the caller chooses (the app uses Caches). Files are
/// protected until first unlock; nothing here is a secret, but a screenshot can show coworkers.
public final class FileBugReportQueueStore: BugReportQueueStore, @unchecked Sendable {
    private let directory: URL
    private let lock = NSLock()
    public init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    private var index: URL { directory.appendingPathComponent("queue.json") }
    private func shotURL(_ id: String) -> URL { directory.appendingPathComponent("\(id).jpg") }
    private var writeOptions: Data.WritingOptions {
        #if os(iOS)
        return [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        #else
        return [.atomic]
        #endif
    }

    public func load() -> [QueuedBugReport] {
        lock.withLock {
            guard let data = try? Data(contentsOf: index) else { return [] }
            let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
            return (try? decoder.decode([QueuedBugReport].self, from: data)) ?? []
        }
    }
    public func save(_ items: [QueuedBugReport]) {
        lock.withLock {
            let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
            if let data = try? encoder.encode(items) { try? data.write(to: index, options: writeOptions) }
        }
    }
    public func screenshot(for reportId: String) -> Data? { lock.withLock { try? Data(contentsOf: shotURL(reportId)) } }
    public func saveScreenshot(_ data: Data, for reportId: String) {
        lock.withLock { try? data.write(to: shotURL(reportId), options: writeOptions) }
    }
    public func removeScreenshot(for reportId: String) {
        lock.withLock { try? FileManager.default.removeItem(at: shotURL(reportId)) }
    }
}

/// The offline queue: at most five reports per uid (the oldest is dropped), seven-day expiry, retries with
/// 2, 8 then 30 second backoff, one report at a time. Discarded per uid on sign-out.
public actor BugReportOutbox {
    public static let maximumPerUser = 5
    public static let lifetime: TimeInterval = 7 * 24 * 3_600
    public static let backoff: [TimeInterval] = [2, 8, 30]

    private let store: any BugReportQueueStore

    public init(store: any BugReportQueueStore) { self.store = store }

    public static func delay(afterAttempts attempts: Int) -> TimeInterval {
        backoff[min(max(attempts - 1, 0), backoff.count - 1)]
    }

    public func pending(uid: String, now: Date = Date()) -> [QueuedBugReport] {
        prune(now: now).filter { $0.report.uid == uid }
    }

    public func enqueue(_ report: BugReport, screenshot: Data?, now: Date = Date()) {
        var items = prune(now: now)
        items.removeAll { $0.report.reportId == report.reportId }
        let mine = items.filter { $0.report.uid == report.uid }
        if mine.count >= Self.maximumPerUser {
            for dropped in mine.prefix(mine.count - Self.maximumPerUser + 1) {
                items.removeAll { $0.report.reportId == dropped.report.reportId }
                store.removeScreenshot(for: dropped.report.reportId)
            }
        }
        if let screenshot, report.includesScreenshot { store.saveScreenshot(screenshot, for: report.reportId) }
        items.append(QueuedBugReport(
            report: report, attempts: 0, nextAttemptAt: now, hasScreenshot: screenshot != nil && report.includesScreenshot))
        store.save(items)
    }

    /// Drops everything queued for `uid` (sign-out) including its screenshots.
    public func discard(uid: String) {
        let items = store.load()
        for item in items where item.report.uid == uid { store.removeScreenshot(for: item.report.reportId) }
        store.save(items.filter { $0.report.uid != uid })
    }

    /// Sends due reports one at a time. Stops at the first transient failure (and schedules the backoff).
    /// Returns how many reports were delivered or permanently dropped.
    @discardableResult
    public func flush(uid: String, using submitter: any BugReportSubmitting, now: Date = Date()) async -> Int {
        var done = 0
        for item in pending(uid: uid, now: now) {
            // Oldest first; a report still backing off holds the line so order is kept.
            guard item.nextAttemptAt <= now else { break }
            guard BugReportValidation.isValid(item.report) else { remove(item.report.reportId); done += 1; continue }
            let screenshot = item.hasScreenshot ? store.screenshot(for: item.report.reportId) : nil
            do {
                try await submitter.submit(item.report, screenshot: screenshot)
                remove(item.report.reportId); done += 1
            } catch BugReportSubmitError.rejected {
                remove(item.report.reportId); done += 1
            } catch {
                reschedule(item.report.reportId, now: now)
                break
            }
        }
        return done
    }

    private func remove(_ id: String) {
        store.save(store.load().filter { $0.report.reportId != id })
        store.removeScreenshot(for: id)
    }

    private func reschedule(_ id: String, now: Date) {
        var items = store.load()
        guard let index = items.firstIndex(where: { $0.report.reportId == id }) else { return }
        items[index].attempts += 1
        items[index].nextAttemptAt = now.addingTimeInterval(Self.delay(afterAttempts: items[index].attempts))
        store.save(items)
    }

    /// Removes expired entries (and their screenshots) and returns the rest.
    private func prune(now: Date) -> [QueuedBugReport] {
        let items = store.load()
        let live = items.filter { now.timeIntervalSince($0.report.createdAt) < Self.lifetime }
        if live.count != items.count {
            for gone in items where !live.contains(where: { $0.report.reportId == gone.report.reportId }) {
                store.removeScreenshot(for: gone.report.reportId)
            }
            store.save(live)
        }
        return live
    }
}

public enum BugReportOutcome: Equatable, Sendable {
    case sent
    case queued
    case failed(BugReportSubmitError)
}

/// Sends a report now, or queues it when there is no connection.
public actor BugReportSender {
    private let submitter: any BugReportSubmitting
    public let outbox: BugReportOutbox
    private let timeout: Duration

    public init(submitter: any BugReportSubmitting, outbox: BugReportOutbox, timeout: Duration = .seconds(20)) {
        self.submitter = submitter; self.outbox = outbox; self.timeout = timeout
    }

    public func send(_ report: BugReport, screenshot: Data?) async -> BugReportOutcome {
        guard BugReportValidation.isValid(report) else { return .failed(.rejected) }
        do {
            try await withTimeout { try await self.submitter.submit(report, screenshot: screenshot) }
            return .sent
        } catch BugReportSubmitError.offline {
            await outbox.enqueue(report, screenshot: screenshot)
            return .queued
        } catch is TimeoutError {
            await outbox.enqueue(report, screenshot: screenshot)
            return .queued
        } catch let error as BugReportSubmitError {
            return .failed(error)
        } catch {
            return .failed(.failed)
        }
    }

    /// Retries queued reports for this member (call when the app becomes active).
    @discardableResult
    public func flushQueue(uid: String) async -> Int { await outbox.flush(uid: uid, using: submitter) }

    public func discardQueue(uid: String) async { await outbox.discard(uid: uid) }

    private struct TimeoutError: Error {}

    /// First finisher wins. Cancelling the job does not cancel an SDK write already handed over; if it lands later,
    /// the queued retry meets the create-only rule and is dropped as already stored, so there is still one report.
    /// A hung SDK call cannot hold the sheet open, because the race does not wait for it.
    private func withTimeout(_ work: @escaping @Sendable () async throws -> Void) async throws {
        let limit = timeout
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let once = ResumeOnce(continuation)
            let job = Task {
                do { try await work(); once.resume(.success(())) } catch { once.resume(.failure(error)) }
            }
            Task {
                try? await Task.sleep(for: limit)
                once.resume(.failure(TimeoutError()))
                job.cancel()
            }
        }
    }
}

private final class ResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?
    init(_ continuation: CheckedContinuation<Void, Error>) { self.continuation = continuation }
    func resume(_ result: Result<Void, Error>) {
        let taken = lock.withLock { () -> CheckedContinuation<Void, Error>? in
            defer { continuation = nil }
            return continuation
        }
        taken?.resume(with: result)
    }
}
