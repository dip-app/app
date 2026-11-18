import Foundation

public enum DIPEventStatus: String, Equatable, Sendable {
    case scheduled
    case cancelled
    /// Closed by the organizer after the event ended. Still visible to members (My Events, Memories, album uploads);
    /// never joinable, discoverable or cancellable.
    case completed
}

/// A presentation state derived from observed event/RSVP data, never permission to write.
public enum DIPEventState: Equatable, Sendable {
    case cancelled, past, started, full, joined, available
}

/// Structured projection of the V1 Event contract. Adapters own wire/date decoding.
public struct DIPEventMetadata: Equatable, Sendable {
    public var startTime: Date
    public var endTime: Date
    public var venueName: String
    public var address: String
    public var locality: String
    public var costCents: Int
    public var costNote: String
    public var capacity: Int
    public var status: DIPEventStatus
    public var revision: Int
    /// Points the event awards (0 = none; the UI hides the points pill at 0).
    public var pointsValue: Int
    /// Organizer edits, oldest first as stored; empty when the event was never changed.
    public var changeLog: [DIPChangeLogEntry]

    public init(startTime: Date, endTime: Date, venueName: String, address: String,
                locality: String, costCents: Int, costNote: String = "", capacity: Int,
                status: DIPEventStatus = .scheduled, revision: Int = 1,
                pointsValue: Int = 0, changeLog: [DIPChangeLogEntry] = []) {
        self.startTime = startTime
        self.endTime = endTime
        self.venueName = venueName
        self.address = address
        self.locality = locality
        self.costCents = costCents
        self.costNote = costNote
        self.capacity = capacity
        self.status = status
        self.revision = revision
        self.pointsValue = max(0, pointsValue)
        self.changeLog = changeLog
    }

    public func state(now: Date, attendeeCount: Int, isJoined: Bool) -> DIPEventState {
        if status == .cancelled { return .cancelled }
        if status == .completed || endTime <= now { return .past }
        if startTime <= now { return .started }
        if isJoined { return .joined }
        if attendeeCount >= capacity { return .full }
        return .available
    }

    public func canCancel(now: Date) -> Bool {
        status == .scheduled && now < startTime
    }

    public var durationMinutes: Int { max(0, Int(endTime.timeIntervalSince(startTime) / 60)) }

    public func dateTimeText(locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        // Include the end date too: overnight and multi-day events must remain unambiguous.
        return String(localized: "event.dateTimeRange", defaultValue: "\(formatter.string(from: startTime)) – \(formatter.string(from: endTime))", bundle: .module, comment: "Event date and time range; first %@ = start, second %@ = end")
    }

    public func priceText(locale: Locale = .current) -> String {
        guard costCents > 0 else { return String(localized: "event.price.free", defaultValue: "Free", bundle: .module, comment: "Event price when the activity costs nothing") }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        let amount = NSDecimalNumber(value: costCents).dividing(by: 100)
        return formatter.string(from: amount) ?? "USD \(amount.stringValue)"
    }

    /// Natural-language text for the native share sheet (two short paragraphs). Pass `link` (`DIPShareLink.url`) to
    /// append it as the last line; cancelled events share no link.
    /// Missing pieces (end time, venue, price, description) are left out gracefully instead of shown as blank labels.
    public func shareText(title: String, description: String = "", link: URL? = nil, locale: Locale = .current,
                          timeZone: TimeZone = .current) -> String {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let subject = name.isEmpty ? String(localized: "event.share.thisActivity", defaultValue: "this activity", bundle: .module, comment: "Share text fallback when the activity has no title; used inside a sentence") : name
        if status == .cancelled {
            return String(localized: "event.share.cancelled", defaultValue: "Heads up: \(subject) has been cancelled. Hopefully we can find another time to get together.", bundle: .module, comment: "Share text for a cancelled activity; %@ = activity title")
        }
        var intro = String(localized: "event.share.intro", defaultValue: "Join me for \(subject)!", bundle: .module, comment: "Share text opening line; %@ = activity title")
        if let sentence = Self.firstSentence(description) {
            intro = String(localized: "event.share.introWithDescription", defaultValue: "Join me for \(subject)! \(sentence)", bundle: .module, comment: "Share text opening line followed by the first sentence of the description; first %@ = activity title, second %@ = description sentence")
        }

        let when = whenPhrase(locale: locale, timeZone: timeZone)
        let place = Self.uniqueJoined([venueName, address, locality])
        var sentences: [String] = []
        if place.isEmpty {
            sentences.append(String(localized: "event.share.when", defaultValue: "It’s \(when).", bundle: .module, comment: "Share text sentence; %@ = time phrase such as on Monday, Nov 9 from 6:00 PM to 7:00 PM"))
        } else {
            sentences.append(String(localized: "event.share.whenAt", defaultValue: "It’s \(when) at \(place).", bundle: .module, comment: "Share text sentence; first %@ = time phrase such as on Monday, Nov 9 from 6:00 PM to 7:00 PM, second %@ = venue and address"))
        }
        let note = costNote.trimmingCharacters(in: .whitespacesAndNewlines)
        if costCents > 0 {
            let price = priceText(locale: locale)
            if note.isEmpty {
                sentences.append(String(localized: "event.share.cost", defaultValue: "It costs \(price).", bundle: .module, comment: "Share text sentence; %@ = price such as $5.00"))
            } else {
                sentences.append(String(localized: "event.share.costNote", defaultValue: "It costs \(price) (\(note)).", bundle: .module, comment: "Share text sentence; first %@ = price such as $5.00, second %@ = organizer's cost note"))
            }
        } else if note.isEmpty {
            sentences.append(String(localized: "event.share.free", defaultValue: "It’s free to join.", bundle: .module, comment: "Share text sentence for a free activity"))
        } else {
            sentences.append(String(localized: "event.share.freeNote", defaultValue: "It’s free to join (\(note)).", bundle: .module, comment: "Share text sentence for a free activity; %@ = organizer's cost note"))
        }
        sentences.append(String(localized: "event.share.closing", defaultValue: "Hope to see you there!", bundle: .module, comment: "Share text closing line"))
        var text = "\(intro)\n\n\(sentences.joined(separator: " "))"
        if let link { text += "\n\n\(link.absoluteString)" }
        return text
    }

    private func whenPhrase(locale: Locale, timeZone: TimeZone) -> String {
        let day = DateFormatter()
        day.locale = locale; day.timeZone = timeZone
        day.setLocalizedDateFormatFromTemplate("EEEEMMMMd")
        let time = DateFormatter()
        time.locale = locale; time.timeZone = timeZone
        time.dateStyle = .none; time.timeStyle = .short
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let startDay = day.string(from: startTime), startTimeText = time.string(from: startTime)
        guard endTime > startTime else {
            return String(localized: "event.share.phrase.start", defaultValue: "on \(startDay) at \(startTimeText)", bundle: .module, comment: "Time phrase in share text, no end; first %@ = date, second %@ = time")
        }
        if calendar.isDate(startTime, inSameDayAs: endTime) {
            let endTimeText = time.string(from: endTime)
            return String(localized: "event.share.phrase.sameDay", defaultValue: "on \(startDay) from \(startTimeText) to \(endTimeText)", bundle: .module, comment: "Time phrase in share text for a same-day event; %@ = date, start time, end time in order")
        }
        let endDay = day.string(from: endTime), endTimeText = time.string(from: endTime)
        return String(localized: "event.share.phrase.multiDay", defaultValue: "from \(startDay) at \(startTimeText) to \(endDay) at \(endTimeText)", bundle: .module, comment: "Time phrase in share text for a multi-day event; %@ = start date, start time, end date, end time in order")
    }

    private static func firstSentence(_ text: String) -> String? {
        let flat = text.split(whereSeparator: \.isNewline).joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !flat.isEmpty else { return nil }
        var end = flat.endIndex
        for terminator in [". ", "! ", "? "] {
            if let range = flat.range(of: terminator), range.lowerBound < end { end = flat.index(after: range.lowerBound) }
        }
        let sentence = String(flat[..<end])
        return sentence.count > 160 ? String(sentence.prefix(159)) + "…" : sentence
    }

    /// Directions link that falls back to searching the event title when no venue, address or locality is
    /// known; nil only when there is no location text at all.
    public func directionsURL(fallbackTitle: String) -> URL? {
        if let url = mapsURL { return url }
        let query = fallbackTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return nil }
        var components = URLComponents(string: "https://maps.apple.com/")
        components?.queryItems = [URLQueryItem(name: "q", value: query)]
        return components?.url
    }

    /// Apple Maps search for the venue (opens Maps or the web page); nil when there is no usable address.
    public var mapsURL: URL? {
        let place = [address, locality].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }.joined(separator: ", ")
        let name = venueName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !place.isEmpty || !name.isEmpty else { return nil }
        var components = URLComponents(string: "https://maps.apple.com/")
        var items: [URLQueryItem] = []
        if !name.isEmpty { items.append(URLQueryItem(name: "q", value: name)) }
        if !place.isEmpty { items.append(URLQueryItem(name: "address", value: place)) }
        components?.queryItems = items
        return components?.url
    }
}
