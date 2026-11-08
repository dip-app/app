import Foundation
import Observation
import DIPContracts
import DIPCore
import DIPAccounts

/// Read-only bridge into the existing app projection. Never mixes live events with fixture state.
@MainActor @Observable final class MemberEventAppRepository: DIPRepository {
    private let reads: MemberEventsRepository
    private let profile: DIPProfile
    private var tagLabels: [String: String] = [:]
    private let clock: () -> Date
    private var query: EventFeedQuery?
    private var cursor: EventFeedCursor?
    private var records: [String: DIPContracts.Event] = [:]
    private var observers: [UUID: AsyncThrowingStream<DIPAppSnapshot, Error>.Continuation] = [:]
    private var generation = UUID()
    private var detailTask: Task<Void, Never>?
    private var detailID: String?
    private(set) var hasMore = false
    private(set) var isLoadingMore = false
    private(set) var paginationError: String?
    private var stopped = false

    init(reads: MemberEventsRepository, profile: DIPProfile, clock: @escaping () -> Date = Date.init) {
        self.reads = reads; self.profile = profile; self.clock = clock
    }
    func observe() async -> AsyncThrowingStream<DIPAppSnapshot, Error> {
        let id = UUID()
        let (stream, continuation) = AsyncThrowingStream<DIPAppSnapshot, Error>.makeStream(bufferingPolicy: .bufferingNewest(1))
        guard !stopped else { continuation.finish(throwing: EventReadFailure.unauthenticated); return stream }
        observers[id] = continuation
        continuation.onTermination = { [weak self] _ in Task { @MainActor in self?.observers.removeValue(forKey: id) } }
        Task { [weak self] in await self?.refresh() }
        return stream
    }
    func refresh() async {
        guard !stopped else { return }
        let token = UUID(); generation = token
        let nextQuery = EventFeedQuery(startsAtOrAfter: clock())
        do {
            let page = try await reads.feed(nextQuery)
            guard generation == token, !stopped else { return }
            query = nextQuery; cursor = page.nextCursor; hasMore = cursor != nil; paginationError = nil
            records = Dictionary(uniqueKeysWithValues: page.events.map { ($0.id!, $0) })
            publish()
            if let detailID { selectDetail(detailID) }
        } catch {
            guard generation == token, !stopped else { return }
            fail(error)
        }
    }
    func loadMore() async {
        guard !stopped, !isLoadingMore, let cursor, let query else { return }
        let token = generation
        isLoadingMore = true; paginationError = nil
        defer { isLoadingMore = false }
        do {
            let page = try await reads.feed(query, after: cursor)
            guard generation == token, !stopped else { return }
            for event in page.events { records[event.id!] = event }
            self.cursor = page.nextCursor; hasMore = self.cursor != nil
            publish()
        } catch {
            guard generation == token, !stopped else { return }
            if error as? EventReadFailure == .unauthenticated { stop() }
            else { paginationError = "Couldn’t load more events. Try again." }
        }
    }
    func selectDetail(_ id: String?) {
        detailTask?.cancel(); detailTask = nil; detailID = id
        guard let id, !stopped else { return }
        detailTask = Task { [weak self, reads] in
            do {
                for try await event in reads.observeDetail(id) {
                    guard let self, !Task.isCancelled, !self.stopped, self.detailID == id else { return }
                    if let event { self.records[id] = event } else { self.records.removeValue(forKey: id) }
                    self.publish()
                }
            } catch {
                guard let self, !Task.isCancelled, !self.stopped else { return }
                self.fail(error)
            }
        }
    }
    func updateTagLabels(_ labels: [String: String]) { tagLabels = labels; if query != nil { publish() } }
    func stop() {
        guard !stopped else { return }; stopped = true; generation = UUID()
        detailTask?.cancel(); detailTask = nil; detailID = nil
        reads.invalidate(); records.removeAll(); cursor = nil; hasMore = false
        fail(EventReadFailure.unauthenticated)
    }
    private func fail(_ error: Error) {
        let current = observers.values; observers.removeAll()
        for observer in current { observer.finish(throwing: error) }
    }
    private func publish() {
        guard !stopped else { return }
        var details: [String: DIPEventDetail] = [:]
        let badgeDate = DateFormatter()
        badgeDate.setLocalizedDateFormatFromTemplate("MMMdjm")
        for (id, event) in records {
            guard let metadata = try? MemberEventsRepository.metadata(event) else { continue }
            // V1-08: category-based default image from the approved catalog URL (falls back to tags).
            details[id] = DIPEventDetail(id: id, title: event.title,
                image: DIPEventCover.media(coverImageURL: event.coverImageURL, tagIds: event.tagIds),
                timing: badgeDate.string(from: event.startTime), description: event.description, tags: event.tagIds.compactMap { tagLabels[$0] },
                attendeeCount: event.attendeeCount, attendeeAvatars: [], isPast: event.endTime <= clock(), metadata: metadata)
        }
        var snapshot = DIPAppSnapshot(home: DIPHomeSnapshot(unreadCount: 0, profileAvatar: profile.avatar,
            challenge: nil, events: [], recentAttendeeAvatars: []), activeEvents: [], memories: [], profile: profile,
            eventDetails: details, participants: [:], albums: [:], messages: [:])
        snapshot.home.events = DIPEventLists(snapshot: snapshot, now: clock()).discovery
        for observer in observers.values { observer.yield(snapshot) }
    }
    func setRSVP(eventID: String, going: Bool) async throws { throw DIPRepositoryError.invalidInput("RSVP isn’t available yet") }
    func updateProfile(_ edit: ProfileEdit) async throws { throw DIPRepositoryError.invalidInput("Use your account profile editor") }
    func sendMessage(eventID: String, messageID: String, text: String) async throws { throw DIPRepositoryError.invalidInput("Chat isn’t available yet") }
    func addPhotos(eventID: String, photos: [PhotoUpload]) async throws { throw DIPRepositoryError.invalidInput("Photo uploads aren’t available yet") }
    func addPhotoComment(eventID: String, photoID: String, commentID: String, text: String) async throws { throw DIPRepositoryError.invalidInput("Comments aren’t available yet") }
}
