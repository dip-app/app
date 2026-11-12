import CoreGraphics
import Foundation

/// Where compact comment bubbles float over a photo. Pure and deterministic: the same comment ids and photo size always give
/// the same positions (derived from a stable hash of each id), so bubbles do not jump on reload or when another arrives.
///
/// Rules: bubbles sit in the outer thirds (top and bottom bands) of the photo, inset from every edge so they never hug a
/// corner or clip, avoid the centre third when there is room, never overlap each other or the reserved rectangles
/// (the attribution tag), and at most `maxVisible` show. More comments collapse into a "+N" pill at the bottom right.
public enum DIPPhotoCommentPlacement {
    public static let maxVisible = 5
    public static let defaultBubble = CGSize(width: 134, height: 32)
    public static let overflowPill = CGSize(width: 56, height: 32)

    public struct Item: Equatable, Sendable {
        public let id: String
        /// Centre in the photo's own coordinate space (origin top left).
        public let center: CGPoint
    }

    public struct Result: Equatable, Sendable {
        public var items: [Item]
        /// Comments that did not fit and open from the "+N" pill (0 = no pill).
        public var overflowCount: Int
        public var overflowCenter: CGPoint?
    }

    /// The photo's central area (this fraction of each side) stays free: that is where the subject usually is.
    public static let centreFraction: CGFloat = 0.4

    /// - Parameters:
    ///   - ids: comment ids oldest first; the newest `maxVisible` are candidates.
    ///   - photo: the photo frame size.
    ///   - reserved: rectangles (photo coordinates) bubbles must avoid, such as the attribution tag.
    /// A candidate that finds no free spot outside the central area joins the "+N" count instead of overlapping.
    public static func layout(ids: [String], photo: CGSize, bubble: CGSize = defaultBubble, inset: CGFloat = 16,
                              gap: CGFloat = 8, reserved: [CGRect] = []) -> Result {
        let unique = ids.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        guard !unique.isEmpty, photo.width > 0, photo.height > 0 else { return Result(items: [], overflowCount: 0, overflowCenter: nil) }
        let candidates = Array(unique.suffix(maxVisible))
        // First try without a pill (up to five bubbles); if anything is left over, reserve the pill and place again.
        let direct = place(candidates, photo: photo, bubble: bubble, inset: inset, gap: gap, reserved: reserved, pill: false)
        if direct.count == unique.count { return Result(items: direct, overflowCount: 0, overflowCenter: nil) }
        let withPill = place(candidates, photo: photo, bubble: bubble, inset: inset, gap: gap, reserved: reserved, pill: true)
        let xr = axis(photo.width, overflowPill.width, inset), yr = axis(photo.height, overflowPill.height, inset)
        return Result(items: withPill, overflowCount: unique.count - withPill.count,
                      overflowCenter: CGPoint(x: xr.upperBound, y: yr.upperBound))
    }

    private static func axis(_ length: CGFloat, _ size: CGFloat, _ inset: CGFloat) -> ClosedRange<CGFloat> {
        let low = inset + size / 2, high = length - inset - size / 2
        return high >= low ? low...high : (length / 2)...(length / 2)
    }

    private static func place(_ ids: [String], photo: CGSize, bubble: CGSize, inset: CGFloat, gap: CGFloat,
                              reserved: [CGRect], pill: Bool) -> [Item] {
        let xs = axis(photo.width, bubble.width, inset), ys = axis(photo.height, bubble.height, inset)
        let pad = gap / 2
        var blocked = reserved.map { $0.insetBy(dx: -pad, dy: -pad) }
        let centre = CGRect(x: photo.width * (1 - centreFraction) / 2, y: photo.height * (1 - centreFraction) / 2,
                            width: photo.width * centreFraction, height: photo.height * centreFraction)
        blocked.append(centre)
        if pill {
            let xr = axis(photo.width, overflowPill.width, inset), yr = axis(photo.height, overflowPill.height, inset)
            blocked.append(rect(CGPoint(x: xr.upperBound, y: yr.upperBound), overflowPill).insetBy(dx: -pad, dy: -pad))
        }
        // Rows: the band above and the band below the central area, each as tall as the inset area allows.
        let topHigh = centre.minY - gap - bubble.height / 2
        let bottomLow = centre.maxY + gap + bubble.height / 2
        let top = ys.lowerBound...max(ys.lowerBound, min(topHigh, ys.upperBound))
        let bottom = min(max(bottomLow, ys.lowerBound), ys.upperBound)...ys.upperBound

        var items: [Item] = []
        // Newest first so the newest comments get the room; the first bubble prefers the lower third, the next the upper.
        for (index, id) in ids.reversed().enumerated() {
            let hash = stableHash(id)
            let order = index % 2 == 0 ? [bottom, top] : [top, bottom]
            var placed: CGPoint?
            search: for band in order {
                for attempt in 0..<64 {
                    let fx = fraction(hash, attempt * 2), fy = fraction(hash, attempt * 2 + 1)
                    let point = CGPoint(x: xs.lowerBound + (xs.upperBound - xs.lowerBound) * fx,
                                        y: band.lowerBound + (band.upperBound - band.lowerBound) * fy)
                    if !collides(rect(point, bubble), blocked) { placed = point; break search }
                }
            }
            if placed == nil {
                // Crowded: sweep both bands for the first free spot.
                scan: for band in order {
                    var y = band.lowerBound
                    while y <= band.upperBound {
                        var x = xs.lowerBound
                        while x <= xs.upperBound {
                            if !collides(rect(CGPoint(x: x, y: y), bubble), blocked) { placed = CGPoint(x: x, y: y); break scan }
                            x += 8
                        }
                        y += 4
                    }
                }
            }
            guard let center = placed else { continue }
            items.append(Item(id: id, center: center))
            blocked.append(rect(center, bubble).insetBy(dx: -pad, dy: -pad))
        }
        // Back to oldest first (the order callers expect).
        return items.reversed()
    }

    /// FNV-1a over the UTF-8 bytes: unlike `hashValue` it is identical on every launch and device.
    public static func stableHash(_ text: String) -> UInt64 {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in text.utf8 { hash = (hash ^ UInt64(byte)) &* 0x100000001b3 }
        return hash
    }

    /// A repeatable value in 0...1 for the given attempt (splitmix64 finalizer over hash and salt).
    static func fraction(_ hash: UInt64, _ salt: Int) -> CGFloat {
        var z = hash &+ UInt64(salt + 1) &* 0x9e3779b97f4a7c15
        z = (z ^ (z >> 30)) &* 0xbf58476d1ce4e5b9
        z = (z ^ (z >> 27)) &* 0x94d049bb133111eb
        z ^= z >> 31
        return CGFloat(z % 10_000) / 9_999
    }

    private static func rect(_ center: CGPoint, _ size: CGSize) -> CGRect {
        CGRect(x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height)
    }
    private static func collides(_ rect: CGRect, _ blocked: [CGRect]) -> Bool { blocked.contains { $0.intersects(rect) } }
}
