import Foundation

/// A point on the screenshot in unit coordinates (0...1 of its width and height), so strokes survive any
/// display size and are scaled to the bitmap when the annotated JPEG is rendered.
public struct MarkupPoint: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public init(x: Double, y: Double) {
        self.x = min(1, max(0, x.isFinite ? x : 0)); self.y = min(1, max(0, y.isFinite ? y : 0))
    }
}

public struct MarkupStroke: Equatable, Sendable {
    public var points: [MarkupPoint]
    public init(points: [MarkupPoint]) { self.points = points }
}

/// Freehand annotations drawn over the report screenshot: draw, undo, clear. Pure value; the editor view owns the
/// gesture and the renderer owns pixels. Bounded so a long scribble cannot grow without limit.
public struct ScreenshotMarkup: Equatable, Sendable {
    public static let maxStrokes = 40
    public static let maxPointsPerStroke = 600
    /// Points closer than this (unit distance) to the previous one are dropped while drawing.
    public static let minimumStep = 0.002

    public private(set) var strokes: [MarkupStroke] = []
    private var isDrawing = false

    public init() {}

    public var isEmpty: Bool { strokes.isEmpty }
    public var canUndo: Bool { !strokes.isEmpty }

    /// Starts a stroke. Returns false (and draws nothing) when the stroke limit is reached.
    @discardableResult
    public mutating func begin(at point: MarkupPoint) -> Bool {
        guard strokes.count < Self.maxStrokes else { isDrawing = false; return false }
        strokes.append(MarkupStroke(points: [point]))
        isDrawing = true
        return true
    }

    public mutating func extend(to point: MarkupPoint) {
        guard isDrawing, let last = strokes.indices.last else { return }
        let points = strokes[last].points
        guard points.count < Self.maxPointsPerStroke, let previous = points.last else { return }
        let dx = point.x - previous.x, dy = point.y - previous.y
        guard (dx * dx + dy * dy).squareRoot() >= Self.minimumStep else { return }
        strokes[last].points.append(point)
    }

    public mutating func end() { isDrawing = false }

    public mutating func undo() {
        guard !strokes.isEmpty else { return }
        strokes.removeLast(); isDrawing = false
    }

    public mutating func clear() { strokes.removeAll(); isDrawing = false }
}
