import DIPCore
import DIPDesignSystem
import SwiftUI
import UIKit

/// Presentation adapter for bundled references, downloaded media and picker bytes.
/// Firebase Storage paths must be resolved by the data adapter before reaching this view.
struct DIPMedia: View {
    let reference: MediaReference
    init(_ reference: MediaReference) { self.reference = reference }

    var body: some View {
        switch reference {
        case .asset(let name):
            DIPReferenceAssets.image(name).resizable()
        case .remote(let url):
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image.resizable()
                } else {
                    placeholder
                }
            }
        case .generatedAvatar(let userID):
            DIPAssignedAvatar(userID: userID)
        case .data(let bytes):
            if let image = UIImage(data: bytes) {
                Image(uiImage: image).resizable()
            } else {
                placeholder
            }
        }
    }

    // Matches the familiar Image composition API; all images above are resizable.
    func resizable() -> Self { self }
    private var placeholder: some View {
        Rectangle().fill(DIPTokens.Color.surfaceMuted.swiftUIColor)
            .overlay { Image(systemName: "photo").foregroundStyle(.secondary) }
    }
}

struct DIPMediaStack: View {
    let references: [MediaReference]
    init(_ references: [MediaReference]) { self.references = references }
    var body: some View {
        HStack(spacing: -4) {
            ForEach(Array(references.enumerated()), id: \.offset) { _, reference in
                DIPMedia(reference).frame(width: 22, height: 22)
            }
        }.accessibilityHidden(true)
    }
}
