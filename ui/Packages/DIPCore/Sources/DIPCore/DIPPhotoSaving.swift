import Foundation

/// Pure rules for the album viewer's position text and for saving photos to the Photos library.
public enum DIPPhotoCount {
    /// "3/12": the viewer's position (clamped so a stale index never shows 0 or past the total).
    public static func text(index: Int, count: Int) -> String {
        let total = max(1, count)
        return "\(min(max(1, index), total))/\(total)"
    }

    /// Width in points for the widest "N/N" label of an album of `count` photos, so the bar never shifts.
    public static func labelWidth(count: Int) -> Double {
        let digits = String(max(1, count)).count
        return max(48, Double(digits * 2) * 10 + 16)
    }

    public static func spoken(index: Int, count: Int) -> String {
        let total = max(1, count)
        return "Photo \(min(max(1, index), total)) of \(total)"
    }
}

/// One "Save all photos" run: which photos to save (skipping those already saved in this session), progress and the
/// final summary. Original resolution only; the stored copies are at most 2048 px JPEGs with location removed.
public struct DIPAlbumSaveProgress: Equatable, Sendable {
    public let total: Int
    public let skipped: Int
    public private(set) var saved = 0
    public private(set) var failed: [String] = []
    public private(set) var cancelled = false

    public init(total: Int, skipped: Int) { self.total = total; self.skipped = skipped }

    /// Splits an album into the photos still to save and the count already saved earlier in this session.
    public static func plan(photoIDs: [String], alreadySaved: Set<String>) -> (toSave: [String], skipped: Int) {
        var seen = Set<String>()
        let unique = photoIDs.filter { seen.insert($0).inserted }
        let pending = unique.filter { !alreadySaved.contains($0) }
        return (pending, unique.count - pending.count)
    }

    public var processed: Int { saved + failed.count }
    public var isFinished: Bool { cancelled || processed >= total }
    /// 0...1 for a progress indicator.
    public var fraction: Double { total == 0 ? 1 : Double(processed) / Double(total) }

    /// "Saving 4 of 12": the photo being saved now, never past the total.
    public var label: String { "Saving \(min(processed + 1, max(total, 1))) of \(total)" }
    public var spokenLabel: String { label }

    public mutating func recordSaved() { saved += 1 }
    public mutating func recordFailed(_ photoID: String) { failed.append(photoID) }
    public mutating func cancel() { cancelled = true }

    /// The toast shown when the run ends.
    public var summary: String {
        func photos(_ n: Int) -> String { n == 1 ? "1 photo" : "\(n) photos" }
        if cancelled { return saved == 0 ? "Stopped" : "Stopped after saving \(photos(saved))" }
        if total == 0 { return "All photos are already saved" }
        if !failed.isEmpty {
            return saved == 0 ? "Couldn’t save \(photos(failed.count)). Try again." : "Saved \(photos(saved)). Couldn’t save \(failed.count)."
        }
        return skipped > 0 ? "Saved \(photos(saved)) · \(skipped) already saved" : "Saved \(photos(saved)) to Photos"
    }
}
