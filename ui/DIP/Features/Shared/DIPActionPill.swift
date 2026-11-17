import DIPCore
import DIPDesignSystem
import SwiftUI
import UIKit

/// The shared pill (Share Event, Directions, Goal, Reward). Pill rule: `solid` means pressable,
/// `outline` means informational (not pressable). Wrap a `solid` pill in a Button or Link; never an `outline` one.
struct DIPActionPill<Icon: View>: View {
    enum Style { case solid, outline }

    let title: String
    let color: Color
    var style: Style = .solid
    /// Icon circle on the left (informational pills) instead of the right (action pills).
    var iconLeading = false
    @ViewBuilder let icon: () -> Icon

    var body: some View {
        HStack(spacing: 0) {
            if iconLeading { iconCircle }
            Text(title)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(style == .solid ? solidLabelColor : color)
                .lineLimit(4).minimumScaleFactor(0.8).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: 29)
            if !iconLeading { iconCircle }
        }
        .padding(5).frame(minHeight: 50)
        .background(style == .solid ? color : .clear, in: Capsule())
        .overlay { if style == .outline { Capsule().strokeBorder(color, lineWidth: 2) } }
        .contentShape(Capsule())
    }

    /// DS-Q4: the label on a solid pill is whichever of white or ink has more contrast on the fill, with white kept on the
    /// brand purple (locked). The Share pill's pink (#F054A5) therefore takes ink (4.98:1) instead of white (3.22:1).
    private var solidLabelColor: Color {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        guard UIColor(color).getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return .white }
        let hex = String(format: "#%02X%02X%02X", Int((red * 255).rounded()), Int((green * 255).rounded()), Int((blue * 255).rounded()))
        return DIPThemeAccent.prefersLightTitle(onHex: hex) ? .white : DIPTokens.Color.textPrimary.swiftUIColor
    }

    private var iconCircle: some View {
        icon().frame(width: 20, height: 20)
            .foregroundStyle(color)
            .frame(width: 40, height: 40)
            .background(style == .solid ? Color.white : color.opacity(0.14), in: Circle())
    }
}
