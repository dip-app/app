import Foundation
import Observation
import DIPContracts
import DIPCore
import DIPAccounts

/// Bridge from company event reads (and, when provided, RSVP participation) into the existing
/// app projection. Never mixes live events with fixture state.
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
    // Participation (nil = read-only: RSVP and attendee lists stay unavailable).
    private let participation: (any ParticipationSource)?
    /// Events the member is going to, from the live RSVP listener (My Events + joined state).
    private var joinedIDs: Set<String> = []
    /// Joined events outside the loaded feed page (e.g. past events), fetched by ID.
    private var joinedRecords: [String: DIPContracts.Event] = [:]
    private var participants: [String: [DIPParticipant]] = [:]
    private var joinedTask: Task<Void, Never>?
    var supportsParticipation: Bool { participation != nil }

    init(reads: MemberEventsRepository, profile: DIPProfile, participation: (any ParticipationSource)? = nil,
         clock: @escaping () -> Date = Date.init) {
        self.reads = reads; self.profile = profile; self.participation = participation; self.clock = clock
    }
    func observe() async -> AsyncThrowingStream<DIPAppSnapshot, Error> {
        let id = UUID()
        let (stream, continuation) = AsyncThrowingStream<DIPAppSnapshot, Error>.makeStream(bufferingPolicy: .bufferingNewest(1))
        guard !stopped else { continuation.finish(throwing: EventReadFailure.unauthenticated); return stream }
        observers[id] = continuation
        continuation.onTermination = { [weak self] _ in Task { @MainActor in self?.observers.removeValue(forKey: id) } }
        Task { [weak self] in await self?.refresh() }
        startJoinedListener()
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
        Task { [weak self] in await self?.loadAttendees(id) }
        detailTask = Task { [weak self, reads] in
            do {
                for try await event in reads.observeDetail(id) {
                    guard let self, !Task.isCancelled, !self.stopped, self.detailID == id else { return }
                    if let event {
                        if self.records[id] != nil || self.joinedRecords[id] == nil { self.records[id] = event }
                        if self.joinedIDs.contains(id) { self.joinedRecords[id] = event }
                    } else { self.records.removeValue(forKey: id); self.joinedRecords.removeValue(forKey: id) }
                    self.publish()
                }
            } catch {
                guard let self, !Task.isCancelled, !self.stopped else { return }
                // An event cancelled while open becomes unreadable to members (rules): drop just
                // that event instead of ending the whole feed. Sign-out still ends everything.
                if error as? EventReadFailure == .permissionDenied {
                    self.records.removeValue(forKey: id); self.joinedRecords.removeValue(forKey: id)
                    self.publish()
                } else { self.fail(error) }
            }
        }
    }
    func updateTagLabels(_ labels: [String: String]) { tagLabels = labels; if query != nil { publish() } }
    func stop() {
        guard !stopped else { return }; stopped = true; generation = UUID()
        detailTask?.cancel(); detailTask = nil; detailID = nil
        joinedTask?.cancel(); joinedTask = nil; participation?.stop()
        joinedIDs.removeAll(); joinedRecords.removeAll(); participants.removeAll()
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
        for (id, event) in joinedRecords.merging(records, uniquingKeysWith: { _, feed in feed }) {
            guard let metadata = try? MemberEventsRepository.metadata(event) else { continue }
            // No approved image catalog is currently available: display the neutral media placeholder.
            details[id] = DIPEventDetail(id: id, title: event.title, image: .data(Data()),
                timing: badgeDate.string(from: event.startTime), description: event.description, tags: event.tagIds.compactMap { tagLabels[$0] },
                isJoined: joinedIDs.contains(id),
                attendeeCount: event.attendeeCount, attendeeAvatars: (participants[id] ?? []).prefix(5).map(\.avatar),
                isPast: event.endTime <= clock(), metadata: metadata)
        }
        var snapshot = DIPAppSnapshot(home: DIPHomeSnapshot(unreadCount: 0, profileAvatar: profile.avatar,
            challenge: nil, events: [], recentAttendeeAvatars: []), activeEvents: [], memories: [], profile: profile,
            eventDetails: details, participants: participants.filter { details[$0.key] != nil }, albums: [:], messages: [:])
        snapshot.home.events = DIPEventLists(snapshot: snapshot, now: clock()).discovery
        for observer in observers.values { observer.yield(snapshot) }
    }
    func setRSVP(eventID: String, going: Bool) async throws {
        guard let participation, !stopped else { throw DIPRepositoryError.invalidInput("RSVP isn’t available yet") }
        let count: Int
        do { count = try await participation.setRsvp(scope: reads.scope, eventID: eventID, going: going) }
        catch { throw DIPRepositoryError.invalidInput((error as? RsvpFailure ?? .unknown).message) }
        guard !stopped else { return }
        // Acknowledgement only: show it now; the RSVP and event listeners confirm it.
        if going { joinedIDs.insert(eventID) } else { joinedIDs.remove(eventID) }
        if var event = records[eventID] ?? joinedRecords[eventID] {
            event.attendeeCount = count
            if records[eventID] != nil { records[eventID] = event }
            if going { joinedRecords[eventID] = event } else { joinedRecords.removeValue(forKey: eventID) }
        }
        publish()
        await loadAttendees(eventID)
    }

    // MARK: Participation

    private func startJoinedListener() {
        guard let participation, joinedTask == nil, !stopped else { return }
        let stream = participation.observeMyGoingEventIDs(scope: reads.scope)
        joinedTask = Task { [weak self] in
            do {
                for try await ids in stream {
                    guard let self, !Task.isCancelled, !self.stopped else { return }
                    self.joinedIDs = ids
                    self.joinedRecords = self.joinedRecords.filter { ids.contains($0.key) }
                    self.publish()
                    await self.loadJoinedDetails()
                }
            } catch {
                // My Events/joined state is unavailable; keep showing company events.
                guard let self, !Task.isCancelled, !self.stopped else { return }
                self.paginationError = "Couldn’t load your RSVPs. Pull to refresh."
            }
        }
    }

    /// Joined events not in the current feed page (e.g. already finished) are fetched by ID.
    private func loadJoinedDetails() async {
        for id in joinedIDs where records[id] == nil && joinedRecords[id] == nil {
            guard !stopped else { return }
            if let event = try? await reads.detail(id), joinedIDs.contains(id), !stopped { joinedRecords[id] = event }
        }
        publish()
    }

    private func loadAttendees(_ eventID: String) async {
        guard let participation, !stopped else { return }
        guard let people = try? await participation.attendees(scope: reads.scope, eventID: eventID), !stopped else { return }
        participants[eventID] = people.map {
            DIPParticipant(id: $0.userID, name: $0.name, department: $0.department, avatar: Self.avatar($0.avatarID))
        }
        publish()
    }

    /// RSVP snapshots carry an avatar ID; until an approved avatar catalog exists, use the
    /// app's neutral bundled character rather than any fixture person's photo.
    nonisolated static func avatar(_ avatarID: String) -> MediaReference { .asset("AvatarTeal") }
    func updateProfile(_ edit: ProfileEdit) async throws { throw DIPRepositoryError.invalidInput("Use your account profile editor") }
    func sendMessage(eventID: String, messageID: String, text: String) async throws { throw DIPRepositoryError.invalidInput("Chat isn’t available yet") }
    func addPhotos(eventID: String, photos: [PhotoUpload]) async throws { throw DIPRepositoryError.invalidInput("Photo uploads aren’t available yet") }
    func addPhotoComment(eventID: String, photoID: String, commentID: String, text: String) async throws { throw DIPRepositoryError.invalidInput("Comments aren’t available yet") }
}
