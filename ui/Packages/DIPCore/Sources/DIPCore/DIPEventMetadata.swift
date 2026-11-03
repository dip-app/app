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

    /// Useful plain text for the native share sheet; V1 does not promise a deep link.
    public func shareText(title: String, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        var lines = [title]
        if status == .cancelled { lines.append("Cancelled") }
        lines.append(dateTimeText(locale: locale, timeZone: timeZone))
        lines.append("Duration: \(durationMinutes) minutes")
        let location = [venueName, address, locality].map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { !$0.isEmpty }
        if !location.isEmpty { lines.append(location.joined(separator: ", ")) }
        let note = costNote.trimmingCharacters(in: .whitespacesAndNewlines)
        lines.append(priceText(locale: locale) + (note.isEmpty ? "" : " — \(note)"))
        return lines.joined(separator: "\n")
    }
}
