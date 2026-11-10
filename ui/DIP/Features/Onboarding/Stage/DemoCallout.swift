import DIPCore
import DIPDesignSystem
import SwiftUI

/// A label for a user-testing finding (spec §3.0 `callout`): ink capsule, white Inter Medium 13, a 6 pt
/// tail pointing at the element it names. It appears with `hop` (scale 0.8 → 1) and holds at least 1.4 s.
/// Callouts wrap to two lines for long localizations.
struct DemoCallout: View {
    let text: String
    var tail: Edge = .top
    /// Horizontal offset of the tail from the capsule's centre, towards the element it points at.
    var tailOffset: CGFloat = 0
    /// 0 → 1 appearance from `DemoCallout.appearance(_:)`; drives scale and opacity so it scrubs.
    var appearance: Double = 1

    static let tailHeight: CGFloat = 6
    static let minimumHold = 1.4
    nonisolated static let entrance = OnboardingAnimation.hop

    var body: some View {
        VStack(spacing: 0) {
            if tail == .top { tailShape.rotationEffect(.degrees(180)) }
            Text(text)
                .font(DIPReferenceAssets.font("Inter-Medium", size: 13))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(maxWidth: 240)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(OnboardingTheme.ink, in: Capsule())
            if tail == .bottom { tailShape }
        }
        .scaleEffect(0.8 + 0.2 * appearance, anchor: tail == .top ? .top : .bottom)
        .opacity(min(1, max(0, appearance * 2)))
        .accessibilityHidden(true)
    }

    private var tailShape: some View {
        CalloutTail()
            .fill(OnboardingTheme.ink)
            .frame(width: 12, height: Self.tailHeight)
            .offset(x: tailOffset)
    }

    /// The scale progress `elapsed` seconds after the callout's beat (`hop`, overshoots slightly).
    nonisolated static func appearance(_ elapsed: Double) -> Double {
        elapsed <= 0 ? 0 : entrance.progress(seconds: elapsed)
    }
}

/// A downward-pointing triangle.
private struct CalloutTail: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
