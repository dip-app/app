#if canImport(SwiftUI)
import SwiftUI

/// A compact photo annotation: avatar first, a few words, then truncation.
/// The complete text remains available to accessibility without expanding the photo layout.
public struct DIPPhotoCommentBubble: View {
    private let text: String
    private let authorName: String
    private let avatar: AnyView
    private let isExpanded: Bool

    public init<Avatar: View>(text: String, authorName: String = "", isExpanded: Bool = false, avatar: () -> Avatar) {
        self.text = text
        self.authorName = authorName
        self.isExpanded = isExpanded
        self.avatar = AnyView(avatar())
    }

    private var preview: String {
        let words = text.split(whereSeparator: \.isWhitespace)
        let firstWords = words.prefix(3).joined(separator: " ")
        return firstWords + (words.count > 3 ? "…" : "")
    }

    public var body: some View {
        Group {
            if isExpanded {
                HStack(alignment: .top, spacing: 8) {
                    avatar.frame(width: 24, height: 24).clipShape(Circle()).accessibilityHidden(true)
                    ViewThatFits(in: .vertical) {
                        fullText
                        ScrollView(.vertical) { fullText }
                            .scrollIndicators(.visible)
                            .accessibilityIdentifier("photo.comments.expanded-text")
                    }
                    .frame(maxHeight: 84)
                }
                .padding(12).frame(width: 280, alignment: .leading)
                .background(.white, in: RoundedRectangle(cornerRadius: 20))
            } else {
                HStack(spacing: 6) {
                    avatar.frame(width: 24, height: 24).clipShape(Circle()).accessibilityHidden(true)
                    Text(preview)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 12))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                        .lineLimit(1).truncationMode(.tail)
                        .frame(maxWidth: 84, alignment: .leading)
                }
                .padding(.leading, 4).padding(.trailing, 8)
                .frame(height: 32)
                .fixedSize(horizontal: true, vertical: true)
                .background(.white, in: Capsule())
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(authorName.isEmpty ? text : "\(authorName): \(text)")
            }
        }
        .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
    }

    private var fullText: some View {
        Text(text)
            .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
            .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
            .lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(authorName.isEmpty ? text : "\(authorName): \(text)")
    }
}
#endif
