import DIPDesignSystem
import SwiftUI

/// The face rig: three continuous controls that SwiftUI can interpolate, so a mood change,
/// a wink or a glance is one animation instead of a swap between drawings.
struct FaceRig: Equatable, Sendable {
    /// −1 worried … 0 calm … 1 happy.
    var smile: Double
    /// Right eye only: 1 open … 0 winked shut.
    var eyeOpen: Double
    /// −1 looking left … 1 looking right.
    var gaze: Double

    init(smile: Double, eyeOpen: Double = 1, gaze: Double = 0) {
        self.smile = smile
        self.eyeOpen = eyeOpen
        self.gaze = gaze
    }

    static let happy = FaceRig(smile: 1, eyeOpen: 1, gaze: 0)
    static let calm = FaceRig(smile: 0, eyeOpen: 1, gaze: 0)
    static let worried = FaceRig(smile: -0.6, eyeOpen: 1, gaze: 0)
    static let wink = FaceRig(smile: 1, eyeOpen: 0, gaze: 0)

    init(_ mood: OnboardingFace.Mood) {
        switch mood {
        case .happy: self = .happy
        case .calm: self = .calm
        case .worried: self = .worried
        case .wink: self = .wink
        }
    }

    func with(gaze: Double) -> FaceRig { var copy = self; copy.gaze = gaze; return copy }
    func with(eyeOpen: Double) -> FaceRig { var copy = self; copy.eyeOpen = eyeOpen; return copy }
}

/// Original onboarding illustration in the app's avatar style: a coloured character on a dark
/// disc, built from shared token colours only (no bundled or third-party artwork).
struct OnboardingFace: View {
    enum Mood { case happy, calm, worried, wink }
    enum Figure { case round, square, pill }

    let fill: Color
    var figure: Figure = .round
    var rig: FaceRig = .happy
    var size: CGFloat = 64

    /// Mood presets keep the original call sites unchanged.
    init(fill: Color, figure: Figure = .round, mood: Mood = .happy, size: CGFloat = 64) {
        self.init(fill: fill, figure: figure, rig: FaceRig(mood), size: size)
    }

    init(fill: Color, figure: Figure = .round, rig: FaceRig, size: CGFloat = 64) {
        self.fill = fill
        self.figure = figure
        self.rig = rig
        self.size = size
    }

    var body: some View {
        ZStack {
            Circle().fill(OnboardingTheme.ink)
            character
                .frame(width: size * 0.82, height: size * 0.82)
                .offset(y: size * 0.16)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var character: some View {
        ZStack {
            shape.fill(fill)
            FaceFeatures(rig: rig)
                .stroke(OnboardingTheme.ink, style: StrokeStyle(
                    lineWidth: max(1.5, size * 0.045), lineCap: .round, lineJoin: .round))
                .padding(size * 0.14)
                .offset(y: -size * 0.04)
        }
    }

    private var shape: AnyShape {
        switch figure {
        case .round: AnyShape(Circle())
        case .square: AnyShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
        case .pill: AnyShape(Capsule())
        }
    }
}

/// Eyes and mouth as one animatable stroke path driven by the rig.
struct FaceFeatures: Shape {
    var rig: FaceRig

    var animatableData: AnimatablePair<Double, AnimatablePair<Double, Double>> {
        get { .init(rig.smile, .init(rig.eyeOpen, rig.gaze)) }
        set {
            rig.smile = newValue.first
            rig.eyeOpen = newValue.second.first
            rig.gaze = newValue.second.second
        }
    }

    /// Control-point offset of the mouth curve, as a fraction of the feature height. Positive
    /// smiles keep the original happy curve (+0.16 h at 1); negative values reach the original
    /// worried curve (−0.12 h) at the worried preset (−0.6).
    static func mouthCurve(smile: Double) -> Double {
        smile >= 0 ? 0.16 * smile : 0.2 * smile
    }

    /// The right eye is one straight stroke through its centre whose angle and half-length
    /// interpolate: vertical (length `eye`) when open, horizontal (length 1.33 `eye`) when shut.
    static func rightEyeStroke(center c: CGPoint, eye: CGFloat, eyeOpen: Double) -> (CGPoint, CGPoint) {
        let open = CGFloat(min(max(eyeOpen, 0), 1))
        let angle = Double.pi / 2 * Double(open)
        let half = eye / 1.5 + (eye / 2 - eye / 1.5) * open
        let dx = half * CGFloat(cos(angle)), dy = half * CGFloat(sin(angle))
        return (CGPoint(x: c.x - dx, y: c.y - dy), CGPoint(x: c.x + dx, y: c.y + dy))
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let w = rect.width, h = rect.height
        let gaze = CGFloat(min(max(rig.gaze, -1), 1))
        let eyeShift = w * 0.06 * gaze
        let eyeY = rect.minY + h * 0.38
        let left = CGPoint(x: rect.minX + w * 0.32 + eyeShift, y: eyeY)
        let right = CGPoint(x: rect.minX + w * 0.68 + eyeShift, y: eyeY)
        let eye = h * 0.09
        path.move(to: CGPoint(x: left.x, y: left.y - eye / 2))
        path.addLine(to: CGPoint(x: left.x, y: left.y + eye / 2))
        let (start, end) = Self.rightEyeStroke(center: right, eye: eye, eyeOpen: rig.eyeOpen)
        path.move(to: start)
        path.addLine(to: end)
        // Mouth: a quadratic curve that flattens to a line at smile 0.
        let mouthShift = w * 0.03 * gaze
        let mouthY = rect.minY + h * 0.66
        path.move(to: CGPoint(x: rect.minX + w * 0.36 + mouthShift, y: mouthY))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX + w * 0.64 + mouthShift, y: mouthY),
            control: CGPoint(x: rect.midX + mouthShift, y: mouthY + h * CGFloat(Self.mouthCurve(smile: rig.smile))))
        return path
    }
}

/// The four Crew members, in their fixed left-to-right order.
enum CrewMember: Int, CaseIterable, Sendable {
    case purple, white, yellow, gray

    var figure: OnboardingFace.Figure {
        switch self {
        case .purple, .gray: .round
        case .white: .pill
        case .yellow: .square
        }
    }

    /// Each member's own colour; a formation may recolour a member for a notice.
    var fill: StageColor {
        switch self {
        case .purple: .accent
        case .white: .inverse
        case .yellow: .notification
        case .gray: .muted
        }
    }

    /// Resting expression in the welcome group. The square face rests eyes-open so its wink
    /// can play as the continuous close → hold → open beat (spec v3 §5).
    var welcomeRig: FaceRig {
        switch self {
        case .purple, .white, .yellow: .happy
        case .gray: .calm
        }
    }
}

/// Token colours the Stage and Crew use, kept as values so formations are testable.
enum StageColor: Equatable, Sendable {
    case accent, inverse, notification, muted, challenge

    var color: Color {
        switch self {
        case .accent: OnboardingTheme.accent
        case .inverse: OnboardingTheme.inverse
        case .notification: OnboardingTheme.notification
        case .muted: OnboardingTheme.muted
        case .challenge: OnboardingTheme.challenge
        }
    }
}

/// Overlapping faces, echoing the app's attendee avatar groups.
struct OnboardingFaceGroup: View {
    var size: CGFloat = 72

    var body: some View {
        HStack(spacing: -size * 0.22) {
            ForEach(CrewMember.allCases, id: \.self) { member in
                OnboardingFace(fill: member.fill.color, figure: member.figure, rig: member.welcomeRig, size: size)
                    .zIndex(Double(CrewMember.allCases.count - member.rawValue))
            }
        }
        .accessibilityHidden(true)
    }
}
