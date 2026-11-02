import DIPDesignSystem
import SwiftUI

/// Original onboarding illustration in the app's avatar style: a coloured character on a dark
/// disc, built from shared token colours only (no bundled or third-party artwork).
struct OnboardingFace: View {
    enum Mood { case happy, calm, worried, wink }
    enum Figure { case round, square, pill }

    let fill: Color
    var figure: Figure = .round
    var mood: Mood = .happy
    var size: CGFloat = 64

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
            FaceFeatures(mood: mood)
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

private struct FaceFeatures: Shape {
    let mood: OnboardingFace.Mood

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let w = rect.width, h = rect.height
        let eyeY = rect.minY + h * 0.38
        let left = CGPoint(x: rect.minX + w * 0.32, y: eyeY)
        let right = CGPoint(x: rect.minX + w * 0.68, y: eyeY)
        let eye = h * 0.09
        // Eyes: short vertical strokes; the wink closes the right eye.
        path.move(to: CGPoint(x: left.x, y: left.y - eye / 2))
        path.addLine(to: CGPoint(x: left.x, y: left.y + eye / 2))
        if mood == .wink {
            path.move(to: CGPoint(x: right.x - eye / 1.5, y: right.y))
            path.addLine(to: CGPoint(x: right.x + eye / 1.5, y: right.y))
        } else {
            path.move(to: CGPoint(x: right.x, y: right.y - eye / 2))
            path.addLine(to: CGPoint(x: right.x, y: right.y + eye / 2))
        }
        // Mouth.
        let mouthY = rect.minY + h * 0.66
        let mouthL = CGPoint(x: rect.minX + w * 0.36, y: mouthY)
        let mouthR = CGPoint(x: rect.minX + w * 0.64, y: mouthY)
        path.move(to: mouthL)
        switch mood {
        case .happy, .wink: path.addQuadCurve(to: mouthR, control: CGPoint(x: rect.midX, y: mouthY + h * 0.16))
        case .calm: path.addLine(to: mouthR)
        case .worried: path.addQuadCurve(to: mouthR, control: CGPoint(x: rect.midX, y: mouthY - h * 0.12))
        }
        return path
    }
}

/// Overlapping faces, echoing the app's attendee avatar groups.
struct OnboardingFaceGroup: View {
    var size: CGFloat = 72
    private let faces: [(Color, OnboardingFace.Figure, OnboardingFace.Mood)] = [
        (OnboardingTheme.accent, .round, .happy),
        (OnboardingTheme.inverse, .pill, .happy),
        (OnboardingTheme.notification, .square, .wink),
        (OnboardingTheme.muted, .round, .calm),
    ]

    var body: some View {
        HStack(spacing: -size * 0.22) {
            ForEach(faces.indices, id: \.self) { index in
                let face = faces[index]
                OnboardingFace(fill: face.0, figure: face.1, mood: face.2, size: size)
                    .zIndex(Double(faces.count - index))
            }
        }
        .accessibilityHidden(true)
    }
}
