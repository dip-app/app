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
                } else if case .failure = phase {
                    DIPMediaFailed()
                } else {
                    DIPMediaLoading()
                }
            }
        case .remoteCover(let url, let fallbackAsset):
            // Bundled tag-based cover while loading and when the hosted image is missing or fails.
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image.resizable()
                } else {
                    DIPReferenceAssets.image(fallbackAsset).resizable()
                }
            }
        case .generatedAvatar(let userID):
            // Flexible: sizes to whatever frame the caller gives it (small stacks and the large profile photo).
            DIPCrewFace(style: .assigned(forUserID: userID))
        case .data(let bytes):
            DIPDataImage(bytes: bytes)
        }
    }

    // Matches the familiar Image composition API; all images above are resizable.
    func resizable() -> Self { self }
}

/// Still waiting for bytes: a plain muted tile, decorative.
private struct DIPMediaLoading: View {
    var body: some View {
        Rectangle().fill(DIPTokens.Color.surfaceMuted.swiftUIColor).accessibilityHidden(true)
    }
}

/// ALB-Q6 / DS-Q5: missing or undecodable bytes and a failed download are distinct from loading: a broken-photo
/// glyph and a spoken label. (AsyncImage has no retry hook, so there is no tap-to-retry here; the surrounding
/// screens retry by reloading.)
private struct DIPMediaFailed: View {
    var body: some View {
        Rectangle().fill(DIPTokens.Color.surfaceMuted.swiftUIColor)
            .overlay {
                Image(systemName: "photo.badge.exclamationmark")
                    .font(.caption).imageScale(.medium)
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.65))
                    .minimumScaleFactor(0.5)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Photo couldn’t load")
            .accessibilityIdentifier("media.failed")
    }
}

/// Decoded, display-ready images keyed by their bytes, so a body re-evaluation never decodes again.
final class DIPDecodedImageCache: @unchecked Sendable {
    static let shared = DIPDecodedImageCache()
    private let cache = NSCache<NSString, UIImage>()

    init(countLimit: Int = 80, byteLimit: Int = 96 * 1_024 * 1_024) {
        cache.countLimit = countLimit; cache.totalCostLimit = byteLimit
    }

    /// Byte count plus three 256-byte samples: constant-time and distinct for different photos, unlike hashing the
    /// whole buffer on every body pass.
    static func key(for data: Data) -> String {
        var hasher = Hasher()
        let n = data.count, window = 256
        for start in [0, max(0, n / 2 - window / 2), max(0, n - window)] {
            let lower = data.startIndex + min(start, n), upper = min(data.endIndex, lower + window)
            hasher.combine(data[lower..<upper])
        }
        return "\(n)-\(hasher.finalize())"
    }

    func image(forKey key: String) -> UIImage? { cache.object(forKey: key as NSString) }

    func store(_ image: UIImage, forKey key: String) {
        let cost = Int(image.size.width * image.scale * image.size.height * image.scale * 4)
        cache.setObject(image, forKey: key as NSString, cost: cost)
    }

    /// Decodes off the main thread and caches. Nil when the bytes are not an image.
    func decode(_ data: Data, key: String) async -> UIImage? {
        if let hit = image(forKey: key) { return hit }
        let decoded = await Task.detached(priority: .userInitiated) { () -> UIImage? in
            guard let image = UIImage(data: data) else { return nil }
            return await image.byPreparingForDisplay() ?? image
        }.value
        if let decoded { store(decoded, forKey: key) }
        return decoded
    }
}

/// Picker/uploaded bytes shown as an image: decoded once off-main into `DIPDecodedImageCache`.
private struct DIPDataImage: View {
    let bytes: Data
    @State private var image: UIImage?
    @State private var failed = false

    init(bytes: Data) {
        self.bytes = bytes
        _image = State(initialValue: DIPDecodedImageCache.shared.image(forKey: DIPDecodedImageCache.key(for: bytes)))
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable()
            } else if failed {
                DIPMediaFailed()
            } else {
                DIPMediaLoading()
            }
        }
        .task(id: DIPDecodedImageCache.key(for: bytes)) {
            let key = DIPDecodedImageCache.key(for: bytes)
            if let hit = DIPDecodedImageCache.shared.image(forKey: key) { image = hit; failed = false; return }
            let decoded = await DIPDecodedImageCache.shared.decode(bytes, key: key)
            image = decoded; failed = decoded == nil
        }
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
