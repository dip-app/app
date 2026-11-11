import DIPCore
import Foundation
import Observation

/// Transient upload drafts for album photos: picked bytes are prepared (JPEG, <= 2048 px), then sent one at a
/// time with per-photo progress. Each photo keeps one stable `PhotoUpload` ID across retries, so a retry can
/// never publish it twice. Published photos come only from repository observation. A finished draft shows its
/// success state for `successDuration`, then is replaced by the real photo: it leaves as soon as the album lists
/// the photo, and at the latest after `graceDuration` more, so a finished tile can never linger when the album
/// stops updating. Owned by the shell, so uploads continue while the member navigates.
@MainActor @Observable
final class AlbumUploadQueue {
    enum State: Equatable {
        case preparing
        case waiting
        case uploading(Double)
        case failed(String)
        /// Published as `photoID`; shown briefly, then replaced by the album's own photo.
        case done(photoID: String)
    }

    struct Item: Identifiable, Equatable {
        let id: String
        let eventID: String
        /// Small local preview (optimistic thumbnail) while the photo is not yet in the album.
        var thumbnail: Data?
        var upload: PhotoUpload?
        var state: State
        var isPending: Bool {
            switch state {
            case .preparing, .waiting, .uploading: true
            case .failed, .done: false
            }
        }
    }

    typealias Send = (_ eventID: String, _ photo: PhotoUpload, _ progress: @escaping @Sendable (Double) -> Void) async throws -> String
    typealias Prepare = @Sendable (Data) throws -> (upload: Data, thumbnail: Data?)

    private(set) var items: [Item] = []
    @ObservationIgnored private let send: Send
    @ObservationIgnored private let prepare: Prepare
    @ObservationIgnored private var worker: Task<Void, Never>?
    @ObservationIgnored private var workerGeneration = 0
    @ObservationIgnored private var runSucceeded = 0
    @ObservationIgnored private var runFailed = 0
    @ObservationIgnored private let successDuration: Duration
    @ObservationIgnored private let graceDuration: Duration
    /// Photo IDs the album last listed per event (the latest `reconcile`), so a draft that finishes after its
    /// photo was already observed can leave without waiting for another album update.
    @ObservationIgnored private var published: [String: Set<String>] = [:]
    @ObservationIgnored private var settlers: [String: Task<Void, Never>] = [:]
    /// Finished drafts whose success state has been shown for `successDuration`.
    @ObservationIgnored private var shown: Set<String> = []
    /// A removed failed draft whose upload had reserved a slot: the host releases it.
    @ObservationIgnored var onDiscard: ((_ uploadID: String) -> Void)?
    /// Called when the queue drains after a run: felt success when everything landed, failure otherwise.
    @ObservationIgnored var onRunFinished: ((_ succeeded: Int, _ failed: Int) -> Void)?

    init(send: @escaping Send, prepare: @escaping Prepare = AlbumUploadQueue.preparePhoto,
         successDuration: Duration = .seconds(1), graceDuration: Duration = .seconds(3)) {
        self.send = send
        self.prepare = prepare
        self.successDuration = successDuration
        self.graceDuration = graceDuration
    }

    func items(for eventID: String) -> [Item] { items.filter { $0.eventID == eventID } }
    func pendingCount(for eventID: String) -> Int { items(for: eventID).filter(\.isPending).count }
    func failedCount(for eventID: String) -> Int {
        items(for: eventID).filter { if case .failed = $0.state { true } else { false } }.count
    }
    /// Drafts that still occupy one of the member's upload slots (pending or failed, not yet published).
    func reservedCount(for eventID: String) -> Int {
        items(for: eventID).filter { if case .done = $0.state { false } else { true } }.count
    }

    /// Adds picked photos. Each loader returns the picker's bytes; failures to read become failed drafts.
    func enqueue(eventID: String, loaders: [@Sendable () async throws -> Data]) {
        for loader in loaders {
            let id = UUID().uuidString
            items.append(Item(id: id, eventID: eventID, thumbnail: nil, upload: nil, state: .preparing))
            let prepare = prepare
            Task { [weak self] in
                var prepared: (upload: Data, thumbnail: Data?)?
                var failure = Self.unreadableMessage
                do {
                    let raw = try await loader()
                    prepared = try await Task.detached(priority: .userInitiated) { try prepare(raw) }.value
                } catch AlbumImageProcessing.Failure.tooLarge {
                    failure = AlbumFailure.tooLarge.message
                } catch {}
                guard let self, let index = self.items.firstIndex(where: { $0.id == id }) else { return }
                if let prepared {
                    self.items[index].upload = PhotoUpload(id: id, data: prepared.upload)
                    self.items[index].thumbnail = prepared.thumbnail
                    self.items[index].state = .waiting
                } else {
                    self.items[index].state = .failed(failure)
                    self.runFailed += 1
                }
                self.startWorker()
            }
        }
    }

    func retry(_ id: String) {
        guard let index = items.firstIndex(where: { $0.id == id }), case .failed = items[index].state,
              items[index].upload != nil else { return }
        items[index].state = .waiting
        startWorker()
    }

    func remove(_ id: String) {
        guard let index = items.firstIndex(where: { $0.id == id }), !items[index].isPending else { return }
        let removed = items.remove(at: index)
        settlers.removeValue(forKey: id)?.cancel(); shown.remove(id)
        if removed.upload != nil, case .failed = removed.state { onDiscard?(id) }
    }

    /// Records what the album lists. A finished draft whose photo is listed leaves once its success state has
    /// been shown, so the real photo takes its place without another album update.
    func reconcile(eventID: String, publishedPhotoIDs: Set<String>) {
        published[eventID] = publishedPhotoIDs
        items.removeAll { item in
            guard item.eventID == eventID, case .done(let photoID) = item.state, shown.contains(item.id) else { return false }
            return publishedPhotoIDs.contains(photoID)
        }
    }

    /// Success state for `successDuration`, then the tile leaves if its photo is listed; otherwise it waits
    /// `graceDuration` for the album and leaves regardless.
    private func settle(_ id: String, eventID: String, photoID: String) {
        settlers[id]?.cancel()
        settlers[id] = Task { [weak self, successDuration, graceDuration] in
            try? await Task.sleep(for: successDuration)
            guard !Task.isCancelled, let self else { return }
            self.shown.insert(id)
            if self.published[eventID]?.contains(photoID) != true {
                try? await Task.sleep(for: graceDuration)
                guard !Task.isCancelled else { return }
            }
            self.items.removeAll { $0.id == id }
            self.shown.remove(id); self.settlers[id] = nil
        }
    }

    /// Sign-out or account switch: drafts belong to that session only.
    func cancelAll() {
        worker?.cancel(); worker = nil; workerGeneration += 1
        settlers.values.forEach { $0.cancel() }; settlers.removeAll(); shown.removeAll(); published.removeAll()
        items.removeAll()
    }

    private func startWorker() {
        guard worker == nil else { return }
        workerGeneration += 1
        let generation = workerGeneration
        worker = Task { [weak self] in
            // Only this run's own handle is cleared; a cancelled stale run never resets a newer worker.
            defer { if let self, self.workerGeneration == generation { self.worker = nil } }
            while let self, !Task.isCancelled, let index = self.items.firstIndex(where: { $0.state == .waiting }) {
                let item = self.items[index]
                guard let upload = item.upload else { self.items[index].state = .failed(Self.unreadableMessage); continue }
                self.update(item.id, .uploading(0))
                do {
                    let photoID = try await self.send(item.eventID, upload) { value in
                        Task { @MainActor [weak self] in self?.progress(item.id, value) }
                    }
                    self.update(item.id, .done(photoID: photoID))
                    self.settle(item.id, eventID: item.eventID, photoID: photoID)
                    self.runSucceeded += 1
                } catch is CancellationError {
                    return
                } catch {
                    self.update(item.id, .failed(Self.message(error)))
                    self.runFailed += 1
                }
            }
            guard let self, self.workerGeneration == generation, !Task.isCancelled else { return }
            // Photos still being prepared will restart the worker; report once everything settled.
            if !self.items.contains(where: { $0.state == .preparing }) {
                let (succeeded, failed) = (self.runSucceeded, self.runFailed)
                self.runSucceeded = 0; self.runFailed = 0
                if succeeded + failed > 0 { self.onRunFinished?(succeeded, failed) }
            }
            // Drafts that became ready while this run was finishing start the next run.
            if self.items.contains(where: { $0.state == .waiting }) { Task { @MainActor [weak self] in self?.startWorker() } }
        }
    }

    private func update(_ id: String, _ state: State) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].state = state
    }

    private func progress(_ id: String, _ value: Double) {
        guard let index = items.firstIndex(where: { $0.id == id }), case .uploading(let current) = items[index].state,
              value > current else { return }
        items[index].state = .uploading(min(1, value))
    }

    static let unreadableMessage = "This photo couldn’t be opened. Choose another one."

    nonisolated static func message(_ error: Error) -> String {
        switch error as? DIPRepositoryError {
        case .invalidInput(let message)?, .injectedFailure(let message)?: message
        case .notFound?: "This album is no longer available."
        case nil: "This photo couldn’t be added. Try again."
        }
    }

    /// JPEG at most 2048 px and 10 MB for upload, plus a small thumbnail for the optimistic tile.
    nonisolated static func preparePhoto(_ data: Data) throws -> (upload: Data, thumbnail: Data?) {
        let upload = try AlbumImageProcessing.prepareUpload(data)
        return (upload, AlbumImageProcessing.displayCopy(upload, maxPixelSize: 400))
    }
}
