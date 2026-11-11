import Foundation

public enum DIPEventStatus: String, Equatable, Sendable {
    case scheduled
    case cancelled
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

    public init(startTime: Date, endTime: Date, venueName: String, address: String,
                locality: String, costCents: Int, costNote: String = "", capacity: Int,
                status: DIPEventStatus = .scheduled, revision: Int = 1) {
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
    }

    public func state(now: Date, attendeeCount: Int, isJoined: Bool) -> DIPEventState {
        if status == .cancelled { return .cancelled }
        if endTime <= now { return .past }
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
        return "\(formatter.string(from: startTime)) – \(formatter.string(from: endTime))"
    }

    public func priceText(locale: Locale = .current) -> String {
        guard costCents > 0 else { return "Free" }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        let amount = NSDecimalNumber(value: costCents).dividing(by: 100)
        return formatter.string(from: amount) ?? "USD \(amount.stringValue)"
    }

    /// Natural-language text for the native share sheet (two short paragraphs); V1 does not promise a deep link.
    /// Missing pieces (end time, venue, price, description) are left out gracefully instead of shown as blank labels.
    public func shareText(title: String, description: String = "", locale: Locale = .current,
                          timeZone: TimeZone = .current) -> String {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let subject = name.isEmpty ? "this activity" : name
        if status == .cancelled {
            return "Heads up: \(subject) has been cancelled. Hopefully we can find another time to get together."
        }
        var intro = "Join me for \(subject)!"
        if let sentence = Self.firstSentence(description) { intro += " \(sentence)" }

        var details = "It’s \(whenPhrase(locale: locale, timeZone: timeZone))"
        let place = Self.uniqueJoined([venueName, address, locality])
        if !place.isEmpty { details += " at \(place)" }
        details += "."
        let note = costNote.trimmingCharacters(in: .whitespacesAndNewlines)
        if costCents > 0 {
            details += " It costs \(priceText(locale: locale))\(note.isEmpty ? "" : " (\(note))")."
        } else {
            details += " It’s free to join\(note.isEmpty ? "" : " (\(note))")."
        }
        return "\(intro)\n\n\(details) Hope to see you there!"
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
        guard endTime > startTime else { return "on \(startDay) at \(startTimeText)" }
        if calendar.isDate(startTime, inSameDayAs: endTime) {
            return "on \(startDay) from \(startTimeText) to \(time.string(from: endTime))"
        }
        return "from \(startDay) at \(startTimeText) to \(day.string(from: endTime)) at \(time.string(from: endTime))"
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
