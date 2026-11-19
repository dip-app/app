import CoreGraphics

/// The geometry of a navigation marker (the white disc) moving along one axis of evenly spaced tab slots. Shared by the
/// phone's horizontal floating bar and the iPhone Duo's vertical rail so both follow the finger the same way: the disc
/// tracks the finger (clamped to the first and last slot), and the tab nearest the disc is the selected one.
///
/// All positions are the marker's leading (bar) or top (rail) edge, measured along the axis in the gesture's
/// coordinate space.
public struct DIPTabMarkerTrack: Equatable, Sendable {
    /// Number of tab slots (at least 1).
    public let count: Int
    /// Marker origin when it rests on the first tab.
    public let firstOrigin: CGFloat
    /// Distance between adjacent slots.
    public let step: CGFloat
    /// Finger position minus marker origin while dragging (where on the disc the finger appears to hold it).
    public let grabOffset: CGFloat

    public init(count: Int, firstOrigin: CGFloat, step: CGFloat, grabOffset: CGFloat) {
        self.count = max(1, count)
        self.firstOrigin = firstOrigin
        self.step = step
        self.grabOffset = grabOffset
    }

    /// Marker origin resting on the tab at `index` (clamped to the slots).
    public func restingOrigin(index: Int) -> CGFloat {
        firstOrigin + step * CGFloat(min(max(index, 0), count - 1))
    }

    /// Marker origin that follows a finger at `location`, kept between the first and last slot.
    public func origin(forFinger location: CGFloat) -> CGFloat {
        min(max(location - grabOffset, firstOrigin), restingOrigin(index: count - 1))
    }

    /// Index of the slot nearest a marker at `origin`.
    public func index(forOrigin origin: CGFloat) -> Int {
        guard step > 0 else { return 0 }
        return min(max(Int(((origin - firstOrigin) / step).rounded()), 0), count - 1)
    }
}

extension DIPTabMarkerTrack {
    /// The phone's floating bar: 80 pt slots whose first and last centres sit 40 pt from the bar ends, a 60 pt disc.
    public static func floatingBar(width: CGFloat, count: Int) -> DIPTabMarkerTrack {
        DIPTabMarkerTrack(
            count: count, firstOrigin: 10, step: (width - 80) / CGFloat(max(1, count - 1)), grabOffset: 40)
    }

    /// The Duo rail: a column of `item` pt circular targets `spacing` apart; the disc is the item itself and the finger
    /// holds its centre.
    public static func rail(count: Int, item: CGFloat, spacing: CGFloat) -> DIPTabMarkerTrack {
        DIPTabMarkerTrack(count: count, firstOrigin: 0, step: item + spacing, grabOffset: item / 2)
    }
}
