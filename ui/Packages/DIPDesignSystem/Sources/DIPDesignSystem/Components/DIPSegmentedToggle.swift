import Foundation

/// Pure geometry for the segmented toggle, unit tested without SwiftUI. Segments share the track
/// width equally; the thumb covers exactly one segment minus a uniform inset on every side.
public struct DIPSegmentedGeometry: Equatable, Sendable {
    public let trackWidth: Double
    public let trackHeight: Double
    public let segmentCount: Int
    public let inset: Double

    public init(trackWidth: Double, trackHeight: Double = 50, segmentCount: Int = 2, inset: Double = 5) {
        self.trackWidth = max(0, trackWidth)
        self.trackHeight = trackHeight
        self.segmentCount = max(1, segmentCount)
        self.inset = inset
    }

    public var segmentWidth: Double { trackWidth / Double(segmentCount) }
    public var thumbWidth: Double { max(0, segmentWidth - inset * 2) }
    public var thumbHeight: Double { max(0, trackHeight - inset * 2) }

    /// Left edge of the thumb when it sits on `index`.
    public func thumbX(for index: Int) -> Double {
        segmentWidth * Double(min(max(index, 0), segmentCount - 1)) + inset
    }

    /// Keeps a dragged thumb inside the track.
    public func clampedThumbX(_ x: Double) -> Double {
        min(max(x, thumbX(for: 0)), thumbX(for: segmentCount - 1))
    }

    /// Segment nearest to a thumb whose left edge is at `x` (where the thumb's centre lies).
    public func nearestIndex(thumbX x: Double) -> Int {
        guard segmentWidth > 0 else { return 0 }
        let centre = x + thumbWidth / 2
        return min(max(Int((centre / segmentWidth).rounded(.down)), 0), segmentCount - 1)
    }
}

#if canImport(SwiftUI)
    import SwiftUI

    /// A two-or-more segment toggle with a white thumb that can be dragged: the thumb follows the finger
    /// anywhere on the track and, on release, springs to the nearest segment (DIPMotion.marker) and reports
    /// the choice. A tap on a segment still works. Each segment is a button with identifier
    /// `<identifierPrefix>.<segment id>` and the selected trait.
    public struct DIPSegmentedToggle<ID: Hashable & Sendable>: View {
        public struct Segment: Identifiable {
            public let id: ID
            public let title: String
            public let identifier: String
            public init(id: ID, title: String, identifier: String) {
                self.id = id; self.title = title; self.identifier = identifier
            }
        }

        private let segments: [Segment]
        private let selection: ID
        public enum Style: Sendable {
            /// Solid accent track, white thumb (My Events).
            case filled
            /// Quiet: faint accent track with a hairline, white thumb with a soft shadow, ink labels.
            case soft
        }

        private let accent: Color
        private let style: Style
        private let inset: Double
        private let height: Double
        private let fontSize: CGFloat
        private let onSelect: (ID) -> Void
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @State private var dragThumbX: Double?

        public init(
            segments: [Segment], selection: ID, accent: Color, style: Style = .filled, height: Double = 50,
            inset: Double = 5, fontSize: CGFloat = 18, onSelect: @escaping (ID) -> Void
        ) {
            self.segments = segments
            self.selection = selection
            self.accent = accent
            self.style = style
            self.inset = inset
            self.height = height
            self.fontSize = fontSize
            self.onSelect = onSelect
        }

        private var selectedIndex: Int { segments.firstIndex { $0.id == selection } ?? 0 }
        private var settle: Animation? { reduceMotion ? .linear(duration: DIPMotion.reducedMotionDuration) : DIPMotion.marker }

        public var body: some View {
            GeometryReader { proxy in
                let geometry = DIPSegmentedGeometry(
                    trackWidth: proxy.size.width, trackHeight: proxy.size.height, segmentCount: segments.count,
                    inset: inset)
                let thumbX = dragThumbX ?? geometry.thumbX(for: selectedIndex)
                let liveIndex = dragThumbX.map { geometry.nearestIndex(thumbX: $0) } ?? selectedIndex
                ZStack(alignment: .leading) {
                    track
                    Capsule().fill(.white)
                        .shadow(color: style == .soft ? DIPComponentTheme.ink.opacity(0.10) : .clear, radius: 4, y: 1)
                        .frame(width: geometry.thumbWidth, height: geometry.thumbHeight)
                        .offset(x: thumbX)
                        .accessibilityHidden(true)
                    HStack(spacing: 0) {
                        ForEach(Array(segments.enumerated()), id: \.element.id) { index, segment in
                            Button { choose(index, geometry: geometry) } label: {
                                Text(segment.title)
                                    .font(DIPReferenceAssets.font("Figtree-Regular", size: fontSize))
                                    .foregroundStyle(labelColor(selected: index == liveIndex))
                                    .lineLimit(1).minimumScaleFactor(0.8)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier(segment.identifier)
                            .accessibilityAddTraits(index == selectedIndex ? .isSelected : [])
                        }
                    }
                }
                .contentShape(Capsule())
                .simultaneousGesture(
                    DragGesture(minimumDistance: 6)
                        .onChanged { value in
                            dragThumbX = geometry.clampedThumbX(value.location.x - geometry.thumbWidth / 2)
                        }
                        .onEnded { value in
                            let x = geometry.clampedThumbX(value.location.x - geometry.thumbWidth / 2)
                            choose(geometry.nearestIndex(thumbX: x), geometry: geometry)
                        })
            }
            .frame(height: height)
            .accessibilityElement(children: .contain)
        }

        @ViewBuilder private var track: some View {
            switch style {
            case .filled: Capsule().fill(accent)
            case .soft:
                Capsule().fill(accent.opacity(0.12))
                    .overlay(Capsule().strokeBorder(accent.opacity(0.30), lineWidth: 1))
            }
        }

        private func labelColor(selected: Bool) -> Color {
            switch style {
            case .filled: selected ? accent : .white
            case .soft: DIPComponentTheme.ink.opacity(selected ? 1 : 0.75)
            }
        }

        private func choose(_ index: Int, geometry: DIPSegmentedGeometry) {
            let next = segments[min(max(index, 0), segments.count - 1)].id
            withAnimation(settle) { dragThumbX = nil }
            if next != selection {
                #if canImport(UIKit)
                    DIPHaptics.select()
                #endif
                onSelect(next)
            }
        }
    }
#endif
