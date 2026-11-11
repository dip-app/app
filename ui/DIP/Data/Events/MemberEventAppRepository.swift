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
    /// Up to three attendees per event for Home card avatar stacks; never shown as a full attendee list.
    private var previews: [String: [DIPParticipant]] = [:]
    private var joinedTask: Task<Void, Never>?
    /// In-flight optimistic RSVPs by event; they override the observed joined state and count while pending.
    private var rsvpStates: [String: DIPOptimisticRSVP] = [:]
    var supportsParticipation: Bool { participation != nil }
    // Live chat (the participation source also implements ChatSource). One listener, for the last opened joined event.
    private let chat: (any ChatSource)?
    private let chatAuthor: ChatAuthor?
    private var messages: [String: [DIPMessage]] = [:]
    private var chatTask: Task<Void, Never>?
    private var chatCandidateID: String?
    private var chatEventID: String?
    // Live album (nil = albums unavailable). One photo listener, for the last opened event; one comment
    // listener, for the photo open in the viewer. Disposed by `stop()` (sign-out / account switch).
    private let albums: (any PhotoAlbumSource)?
    private var albumEventID: String?
    private var albumTask: Task<Void, Never>?
    private var albumRecords: [AlbumPhotoRecord] = []
    private var albumLoaded = false
    private var albumError: String?
    /// Display JPEGs by photo ID for the open album (bounded by the album listener size).
    private var albumImages: [String: Data] = [:]
    private var albumImagesLoading: Set<String> = []
    /// The member's own published slots per event (from a one-shot query plus the listener).
    private var ownSlots: [String: Set<Int>] = [:]
    /// Slots held by abandoned, never-finalized uploads (create-only, so they stay used).
    private var occupiedSlots: [String: Set<Int>] = [:]
    /// Slot of each in-flight or failed upload by its stable ID, so a retry reuses its slot.
    private var uploadSlots: [String: (eventID: String, slot: Int)] = [:]
    private var commentTask: Task<Void, Never>?
    private var commentKey: (eventID: String, photoID: String)?
    private var photoComments: [String: [String: [DIPPhotoComment]]] = [:]

    init(reads: MemberEventsRepository, profile: DIPProfile, participation: (any ParticipationSource)? = nil,
         albums: (any PhotoAlbumSource)? = nil, chatAuthor: ChatAuthor? = nil, clock: @escaping () -> Date = Date.init) {
        self.reads = reads; self.profile = profile; self.participation = participation; self.clock = clock
        self.chat = participation as? any ChatSource; self.chatAuthor = chatAuthor; self.albums = albums
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
            prefetchPreviews(for: page.events.compactMap(\.id), token: token)
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
            prefetchPreviews(for: page.events.compactMap(\.id), token: token)
        } catch {
            guard generation == token, !stopped else { return }
            if error as? EventReadFailure == .unauthenticated { stop() }
            else { paginationError = "Couldn’t load more events. Try again." }
        }
    }
    func selectDetail(_ id: String?) {
        detailTask?.cancel(); detailTask = nil; detailID = id
        // Keep the chat listener while a chat sheet may still be open (nil = left the event page).
        if let id { chatCandidateID = id; syncChat(); syncAlbum(id) }
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
        chatTask?.cancel(); chatTask = nil; chatEventID = nil; chatCandidateID = nil; messages.removeAll(); rsvpStates.removeAll()
        albumTask?.cancel(); albumTask = nil; albumEventID = nil; albumRecords.removeAll(); albumImages.removeAll()
        commentTask?.cancel(); commentTask = nil; commentKey = nil; photoComments.removeAll()
        ownSlots.removeAll(); occupiedSlots.removeAll(); uploadSlots.removeAll(); albums?.stop()
        joinedTask?.cancel(); joinedTask = nil; participation?.stop()
        joinedIDs.removeAll(); joinedRecords.removeAll(); participants.removeAll(); previews.removeAll()
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
            // V1-08: category-based default image from the approved catalog URL (falls back to tags).
            details[id] = DIPEventDetail(id: id, title: event.title,
                image: DIPEventCover.media(coverImageURL: event.coverImageURL, tagIds: event.tagIds),
                timing: badgeDate.string(from: event.startTime), description: event.description, tags: event.tagIds.compactMap { tagLabels[$0] },
                isJoined: rsvpStates[id]?.pending != nil ? rsvpStates[id]!.isGoing : joinedIDs.contains(id),
                attendeeCount: rsvpStates[id]?.pending != nil ? rsvpStates[id]!.attendeeCount : event.attendeeCount, attendeeAvatars: (participants[id] ?? previews[id] ?? []).prefix(5).map(\.avatar),
                isPast: event.endTime <= clock(), metadata: metadata)
        }
        var snapshot = DIPAppSnapshot(home: DIPHomeSnapshot(unreadCount: 0, profileAvatar: profile.avatar,
            challenge: nil, events: [], recentAttendeeAvatars: []), activeEvents: [], memories: [], profile: profile,
            eventDetails: details, participants: participants.filter { details[$0.key] != nil }, albums: albumProjection(details),
            messages: messages, photoComments: photoComments)
        snapshot.home.events = DIPEventLists(snapshot: snapshot, now: clock()).discovery
        for observer in observers.values { observer.yield(snapshot) }
    }
    /// Optimistic: after a local reasonableness check the UI flips at once (joined state, attendee count, My Events,
    /// Home cards) and rolls back only if the server rejects or fails. The latest intent wins; the RSVP and event
    /// listeners reconcile once the server state arrives.
    func setRSVP(eventID: String, going: Bool) async throws {
        guard let participation, !stopped else { throw DIPRepositoryError.invalidInput("RSVP isn’t available yet") }
        let requestID = UUID().uuidString
        if let event = records[eventID] ?? joinedRecords[eventID], let metadata = try? MemberEventsRepository.metadata(event) {
            let state = rsvpStates[eventID] ?? DIPOptimisticRSVP(going: joinedIDs.contains(eventID), attendeeCount: event.attendeeCount)
            if let denial = DIPParticipationRules.denial(going: going, metadata: metadata, attendeeCount: state.attendeeCount,
                                                         isGoing: state.isGoing, now: clock()) {
                throw DIPRepositoryError.invalidInput(denial.message)
            }
            var next = state
            next.begin(going: going, requestID: requestID)
            rsvpStates[eventID] = next
            publish()
        }
        let count: Int
        do { count = try await participation.setRsvp(scope: reads.scope, eventID: eventID, going: going) }
        catch {
            if var state = rsvpStates[eventID], state.fail(requestID: requestID) { rsvpStates[eventID] = nil; publish() }
            throw DIPRepositoryError.invalidInput((error as? RsvpFailure ?? .unknown).message)
        }
        guard !stopped else { return }
        // A newer intent replaced this request: its own result decides the final state.
        if let state = rsvpStates[eventID], state.pending?.requestID != requestID { return }
        rsvpStates[eventID] = nil
        // Acknowledgement: the RSVP and event listeners confirm it.
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
                    self.syncChat()
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

    /// Card avatar stacks must not wait for an event to be opened: after each feed page, read up to
    /// three going attendees for events that have attendees and no cached list. Bounded (4 reads in
    /// flight, one pass per page), cached in `participants`, and it never blocks the feed. Until a
    /// preview arrives the card shows only its count chip; a failed preview is simply retried with the
    /// next feed refresh.
    private func prefetchPreviews(for ids: [String], token: UUID) {
        guard let participation, !stopped else { return }
        let wanted = ids.filter { id in
            participants[id] == nil && previews[id] == nil && (records[id]?.attendeeCount ?? 0) > 0
        }
        guard !wanted.isEmpty else { return }
        let scope = reads.scope
        Task { [weak self] in
            var index = 0
            while index < wanted.count {
                let batch = wanted[index..<min(index + 4, wanted.count)]
                index += 4
                let reads = batch.map { id in
                    (id, Task { @MainActor in
                        try? await participation.previewAttendees(scope: scope, eventID: id, limit: 3)
                    })
                }
                var results: [(String, [RsvpAttendee])] = []
                for (id, task) in reads { if let people = await task.value { results.append((id, people)) } }
                guard let self, self.generation == token, !self.stopped else { return }
                for (id, people) in results where self.previews[id] == nil {
                    self.previews[id] = people.map {
                        DIPParticipant(id: $0.userID, name: $0.name, department: $0.department,
                                       avatar: Self.avatar(userID: $0.userID), jobTitle: $0.jobTitle)
                    }
                }
                if !results.isEmpty { self.publish() }
            }
        }
    }

    private func loadAttendees(_ eventID: String) async {
        guard let participation, !stopped else { return }
        guard let people = try? await participation.attendees(scope: reads.scope, eventID: eventID), !stopped else { return }
        participants[eventID] = people.map {
            DIPParticipant(id: $0.userID, name: $0.name, department: $0.department,
                           avatar: Self.avatar(userID: $0.userID), jobTitle: $0.jobTitle)
        }
        publish()
    }

    /// RSVP snapshots carry an avatar ID but no approved avatar catalog exists, so attendees get the
    /// app-assigned avatar derived from their user id (never a fixture person's photo).
    nonisolated static func avatar(userID: String) -> MediaReference { .generatedAvatar(userID: userID) }
    func updateProfile(_ edit: ProfileEdit) async throws { throw DIPRepositoryError.invalidInput("Use your account profile editor") }
    func sendMessage(eventID: String, messageID: String, text: String) async throws {
        guard let chat, let chatAuthor, !stopped else { throw DIPRepositoryError.invalidInput("Chat isn’t available yet") }
        do {
            try await chat.sendMessage(scope: reads.scope, eventID: eventID, messageID: messageID, text: text, author: chatAuthor)
        } catch { throw DIPRepositoryError.invalidInput((error as? ChatFailure ?? .unknown).message) }
    }
    func notificationLevel(eventID: String) async throws -> DIPNotificationLevel? {
        guard let chat, !stopped else { return nil }
        return try? await chat.notificationLevel(scope: reads.scope, eventID: eventID)
    }
    func setNotificationLevel(eventID: String, level: DIPNotificationLevel) async throws {
        guard let chat, !stopped else { throw DIPRepositoryError.invalidInput("Notification settings aren’t available yet") }
        do { try await chat.setNotificationLevel(scope: reads.scope, eventID: eventID, level: level) }
        catch { throw DIPRepositoryError.invalidInput("Couldn’t save your notification setting. Please try again.") }
    }

    /// Listens to the messages of the last opened event while the member is going to it; the listener is
    /// disposed when another event is opened, the member leaves it, or the repository stops (account switch).
    private func syncChat() {
        guard let chat, !stopped else { return }
        let wanted = chatCandidateID.flatMap { joinedIDs.contains($0) ? $0 : nil }
        if wanted == chatEventID, wanted == nil || chatTask != nil { return }
        chatTask?.cancel(); chatTask = nil
        if let old = chatEventID { messages[old] = nil }
        chatEventID = wanted
        guard let wanted else { publish(); return }
        let stream = chat.observeMessages(scope: reads.scope, eventID: wanted)
        chatTask = Task { [weak self] in
            do {
                for try await records in stream {
                    guard let self, !Task.isCancelled, !self.stopped, self.chatEventID == wanted else { return }
                    self.messages[wanted] = records.map {
                        DIPMessage(id: $0.id, authorID: $0.authorID, text: $0.text, authorName: $0.authorName,
                                   authorAvatar: Self.avatar(userID: $0.authorID), createdAt: $0.createdAt)
                    }
                    self.publish()
                }
            } catch {
                // Read denied or offline: keep what is shown; reopening the event restarts the listener.
                guard let self, !Task.isCancelled, self.chatEventID == wanted else { return }
                self.chatTask = nil
            }
        }
    }
    // MARK: Album

    /// The album of the open event once it has ended. Upload rights mirror gcp/storage.rules: a going RSVP to an
    /// ended, scheduled event; the remaining count subtracts published and abandoned slots.
    private func albumProjection(_ details: [String: DIPEventDetail]) -> [String: DIPAlbum] {
        guard albums != nil, let id = albumEventID, let detail = details[id], detail.isPast,
              let event = joinedRecords[id] ?? records[id] else { return [:] }
        let mine = ownSlots[id, default: []].union(albumRecords.compactMap { AlbumPolicy.slot(photoID: $0.id, uid: reads.scope.uid) })
        let remaining = max(0, AlbumPolicy.slotsPerMember - mine.union(occupiedSlots[id, default: []]).count)
        let photos = albumRecords.map { record in
            DIPPhoto(id: record.id, image: albumImages[record.id].map(MediaReference.data) ?? .data(Data()),
                     attribution: DIPPhotoAttribution(name: record.uploaderName, avatar: Self.avatar(userID: record.uploaderID)))
        }
        return [id: DIPAlbum(id: id, eventID: id, title: event.title, photos: photos,
                             canAddPhotos: canUpload(id),
                             remainingUploads: remaining, isLoaded: albumLoaded, loadError: albumError)]
    }

    /// Follows the last opened event; the listener is replaced when another event is opened.
    private func syncAlbum(_ eventID: String) {
        guard let albums, !stopped, eventID != albumEventID || albumTask == nil else { return }
        albumTask?.cancel()
        if albumEventID != eventID { albumRecords = []; albumImages = [:]; albumImagesLoading = []; albumLoaded = false }
        albumEventID = eventID; albumError = nil
        let stream = albums.observePhotos(scope: reads.scope, eventID: eventID)
        albumTask = Task { [weak self] in
            do {
                for try await records in stream {
                    guard let self, !Task.isCancelled, !self.stopped, self.albumEventID == eventID else { return }
                    self.albumRecords = records; self.albumLoaded = true; self.albumError = nil
                    self.publish()
                    self.loadAlbumImages(eventID: eventID)
                }
            } catch {
                guard let self, !Task.isCancelled, !self.stopped, self.albumEventID == eventID else { return }
                // Keep what is shown; reopening the event restarts the listener.
                self.albumTask = nil; self.albumLoaded = true
                self.albumError = (error as? AlbumFailure) == .unavailable
                    ? "Couldn’t load photos. Check your connection." : "Couldn’t load this album."
                self.publish()
            }
        }
    }

    /// Downloads missing photo bytes through the authenticated SDK, four at a time, newest first.
    private func loadAlbumImages(eventID: String) {
        guard let albums else { return }
        let wanted = albumRecords.filter { albumImages[$0.id] == nil && !albumImagesLoading.contains($0.id) }
        guard !wanted.isEmpty else { return }
        wanted.forEach { albumImagesLoading.insert($0.id) }
        Task { [weak self] in
            var index = 0
            while index < wanted.count {
                let batch = wanted[index..<min(index + 4, wanted.count)]
                index += 4
                let downloads = batch.map { record in
                    (record.id, Task { @MainActor () -> Data? in
                        guard let data = try? await albums.imageData(path: record.storagePath) else { return nil }
                        return await Task.detached(priority: .utility) { AlbumImageProcessing.displayCopy(data) }.value
                    })
                }
                var loaded: [(String, Data)] = []
                for (id, task) in downloads { if let data = await task.value { loaded.append((id, data)) } }
                guard let self, !self.stopped, self.albumEventID == eventID else { return }
                for (id, data) in loaded { self.albumImages[id] = data }
                // A failed download is retried on the next album snapshot or reopen.
                batch.forEach { self.albumImagesLoading.remove($0.id) }
                if !loaded.isEmpty { self.publish() }
            }
        }
    }

    /// The photo open in the viewer (nil when it closes): its comment thread is observed live.
    func selectPhoto(eventID: String, photoID: String?) {
        guard let albums, !stopped else { return }
        if let key = commentKey, key.eventID == eventID, key.photoID == photoID, commentTask != nil { return }
        commentTask?.cancel(); commentTask = nil
        if let old = commentKey { photoComments[old.eventID]?[old.photoID] = nil }
        guard let photoID else { commentKey = nil; publish(); return }
        commentKey = (eventID, photoID)
        let stream = albums.observeComments(scope: reads.scope, eventID: eventID, photoID: photoID)
        commentTask = Task { [weak self] in
            do {
                for try await records in stream {
                    guard let self, !Task.isCancelled, !self.stopped, self.commentKey?.photoID == photoID else { return }
                    self.photoComments[eventID, default: [:]][photoID] = records.map {
                        DIPPhotoComment(id: $0.id, authorID: $0.authorID, authorName: $0.authorName,
                                        authorAvatar: Self.avatar(userID: $0.authorID), text: $0.text, createdAt: $0.createdAt)
                    }
                    self.publish()
                }
            } catch {
                guard let self, !Task.isCancelled, self.commentKey?.photoID == photoID else { return }
                self.commentTask = nil
            }
        }
    }

    func addPhotos(eventID: String, photos: [PhotoUpload]) async throws {
        for photo in photos { _ = try await uploadPhoto(eventID: eventID, photo: photo, progress: { _ in }) }
    }

    /// Uploads one prepared JPEG into a free slot and publishes it with finalizeEventPhotoV1. A retry with the same
    /// upload ID reuses its slot: if the bytes already landed, the create-only write is recognized by checksum and
    /// only the (idempotent) finalize runs again, so a photo is never published twice.
    func uploadPhoto(eventID: String, photo: PhotoUpload, progress: @escaping @Sendable (Double) -> Void) async throws -> String {
        guard let albums, !stopped else { throw DIPRepositoryError.invalidInput("Photo uploads aren’t available yet") }
        let scope = reads.scope
        guard canUpload(eventID) else { throw DIPRepositoryError.invalidInput(AlbumFailure.notAttendee.message) }
        do {
            if ownSlots[eventID] == nil {
                let ids = try await albums.ownPhotoIDs(scope: scope, eventID: eventID)
                ownSlots[eventID, default: []].formUnion(ids.compactMap { AlbumPolicy.slot(photoID: $0, uid: scope.uid) })
            }
            var slot = try reserveSlot(eventID: eventID, uploadID: photo.id)
            while try await albums.upload(scope: scope, eventID: eventID, slot: slot, jpeg: photo.data, progress: progress) == .slotOccupied {
                occupiedSlots[eventID, default: []].insert(slot)
                uploadSlots[photo.id] = nil
                slot = try reserveSlot(eventID: eventID, uploadID: photo.id)
            }
            let photoID = try await albums.finalize(scope: scope, eventID: eventID, slot: slot)
            uploadSlots[photo.id] = nil
            ownSlots[eventID, default: []].insert(slot)
            // Our own bytes are already here: show them without a download.
            if albumEventID == eventID, albumImages[photoID] == nil,
               let display = await Task.detached(priority: .utility, operation: { AlbumImageProcessing.displayCopy(photo.data) }).value {
                albumImages[photoID] = display
            }
            publish()
            return photoID
        } catch {
            let failure = error as? AlbumFailure ?? FirebasePhotoAlbumSource.failure(error)
            // The server deleted an invalid object, so its slot is free again.
            if failure == .invalidImage { uploadSlots[photo.id] = nil }
            publish()
            throw DIPRepositoryError.invalidInput(failure.message)
        }
    }

    private func reserveSlot(eventID: String, uploadID: String) throws -> Int {
        if let reserved = uploadSlots[uploadID], reserved.eventID == eventID { return reserved.slot }
        let inFlight = Set(uploadSlots.values.filter { $0.eventID == eventID }.map(\.slot))
        let published = albumRecords.compactMap { AlbumPolicy.slot(photoID: $0.id, uid: reads.scope.uid) }
        let taken = ownSlots[eventID, default: []].union(occupiedSlots[eventID, default: []]).union(inFlight).union(published)
        guard let slot = AlbumPolicy.freeSlot(taken: taken) else { throw AlbumFailure.limitReached }
        uploadSlots[uploadID] = (eventID, slot)
        return slot
    }

    /// Mirrors the Storage upload rule: going RSVP, event scheduled and ended.
    private func canUpload(_ eventID: String) -> Bool {
        guard albums != nil, joinedIDs.contains(eventID), let event = joinedRecords[eventID] ?? records[eventID] else { return false }
        return event.status == "scheduled" && event.endTime <= clock()
    }

    func addPhotoComment(eventID: String, photoID: String, commentID: String, text: String) async throws {
        guard let albums, let chatAuthor, !stopped else { throw DIPRepositoryError.invalidInput("Comments aren’t available yet") }
        do {
            try await albums.addComment(scope: reads.scope, eventID: eventID, photoID: photoID, commentID: commentID,
                                        text: text, author: chatAuthor)
        } catch {
            throw DIPRepositoryError.invalidInput((error as? AlbumFailure) == .unavailable
                ? AlbumFailure.unavailable.message : "Your comment could not be sent. Try again.")
        }
    }
}
