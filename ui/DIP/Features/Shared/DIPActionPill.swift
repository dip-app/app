import DIPDesignSystem
import SwiftUI

/// The shared pill (Share Event, Directions, Goal, Reward). Pill rule: `solid` means pressable,
/// `outline` means informational (not pressable). Wrap a `solid` pill in a Button or Link; never an `outline` one.
struct DIPActionPill<Icon: View>: View {
    enum Style { case solid, outline }

    let title: String
    let color: Color
    var style: Style = .solid
    @ViewBuilder let icon: () -> Icon

    var body: some View {
        HStack(spacing: 0) {
            Text(title)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(style == .solid ? .white : color)
                .lineLimit(2).minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, minHeight: 29)
            icon().frame(width: 20, height: 20)
                .foregroundStyle(color)
                .frame(width: 40, height: 40)
                .background(style == .solid ? Color.white : color.opacity(0.14), in: Circle())
        }
        .padding(5).frame(minHeight: 50)
        .background(style == .solid ? color : .clear, in: Capsule())
        .overlay { if style == .outline { Capsule().strokeBorder(color, lineWidth: 2) } }
        .contentShape(Capsule())
    }
}
