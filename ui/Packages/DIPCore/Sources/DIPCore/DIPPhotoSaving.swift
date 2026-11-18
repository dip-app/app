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
        return String(localized: "album.photo.spoken", defaultValue: "Photo \(min(max(1, index), total)) of \(total)", bundle: .module, comment: "VoiceOver position in the album viewer; first %lld = photo number, second %lld = total photos")
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
    public var label: String { String(localized: "album.save.progress", defaultValue: "Saving \(min(processed + 1, max(total, 1))) of \(total)", bundle: .module, comment: "Progress while saving all album photos; first %lld = photo being saved, second %lld = total") }
    public var spokenLabel: String { label }

    public mutating func recordSaved() { saved += 1 }
    public mutating func recordFailed(_ photoID: String) { failed.append(photoID) }
    public mutating func cancel() { cancelled = true }

    /// The toast shown when the run ends.
    public var summary: String {
        if cancelled {
            return saved == 0
                ? String(localized: "album.save.stopped", defaultValue: "Stopped", bundle: .module, comment: "Toast when saving all photos was cancelled before any was saved")
                : String(localized: "album.save.stoppedAfter", defaultValue: saved == 1 ? "Stopped after saving \(saved) photo" : "Stopped after saving \(saved) photos", bundle: .module, comment: "Toast when saving was cancelled; %lld = photos saved so far")
        }
        if total == 0 { return String(localized: "album.save.allSaved", defaultValue: "All photos are already saved", bundle: .module, comment: "Toast when every photo was saved earlier") }
        if !failed.isEmpty {
            return saved == 0
                ? String(localized: "album.save.failedAll", defaultValue: failed.count == 1 ? "Couldn’t save \(failed.count) photo. Try again." : "Couldn’t save \(failed.count) photos. Try again.", bundle: .module, comment: "Toast when no photo could be saved; %lld = photos that failed")
                : String(localized: "album.save.partial", defaultValue: saved == 1 ? "Saved \(saved) photo. Couldn’t save \(failed.count)." : "Saved \(saved) photos. Couldn’t save \(failed.count).", bundle: .module, comment: "Toast when some photos failed; first %lld = photos saved, second %lld = photos that failed")
        }
        return skipped > 0
            ? String(localized: "album.save.doneSkipped", defaultValue: saved == 1 ? "Saved \(saved) photo · \(skipped) already saved" : "Saved \(saved) photos · \(skipped) already saved", bundle: .module, comment: "Toast after saving; first %lld = photos saved now, second %lld = photos already saved before")
            : String(localized: "album.save.done", defaultValue: saved == 1 ? "Saved \(saved) photo to Photos" : "Saved \(saved) photos to Photos", bundle: .module, comment: "Toast after saving all photos; %lld = photos saved")
    }
}
