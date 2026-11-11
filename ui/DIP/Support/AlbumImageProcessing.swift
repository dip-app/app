import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Image preparation for album uploads and display, through ImageIO only (never a web view).
///
/// Uploads are re-encoded as JPEG with the long edge capped at `AlbumPolicy.maxPixelSize`, which also converts
/// HEIC/PNG picks and drops all metadata (location, device) from the published file. Display copies are smaller
/// JPEGs kept in memory for the grid and the viewer.
enum AlbumImageProcessing {
    enum Failure: Error, Equatable { case unreadable, tooLarge }

    /// Re-encodes picker bytes into an upload-ready JPEG of at most `AlbumPolicy.maxBytes`.
    static func prepareUpload(_ data: Data, maxPixelSize: Int = AlbumPolicy.maxPixelSize,
                              maxBytes: Int = AlbumPolicy.maxBytes) throws -> Data {
        guard let image = downsample(data, maxPixelSize: maxPixelSize).flatMap(opaque) else { throw Failure.unreadable }
        for quality in [0.85, 0.7, 0.55, 0.4] {
            if let jpeg = jpeg(image, quality: quality), jpeg.count <= maxBytes { return jpeg }
        }
        throw Failure.tooLarge
    }

    /// A smaller JPEG for on-screen use, or nil when the bytes are not an image.
    static func displayCopy(_ data: Data, maxPixelSize: Int = AlbumPolicy.displayPixelSize) -> Data? {
        downsample(data, maxPixelSize: maxPixelSize).flatMap { jpeg($0, quality: 0.8) }
    }

    /// Decodes at most `maxPixelSize` on the long edge (orientation applied), without decoding the full image.
    static func downsample(_ data: Data, maxPixelSize: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(source) > 0 else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    /// JPEG has no alpha: transparent pixels (PNG) are drawn onto white instead of turning black.
    static func opaque(_ image: CGImage) -> CGImage? {
        guard image.alphaInfo != .none, image.alphaInfo != .noneSkipLast, image.alphaInfo != .noneSkipFirst else { return image }
        guard let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return nil }
        let rect = CGRect(x: 0, y: 0, width: image.width, height: image.height)
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(rect)
        context.draw(image, in: rect)
        return context.makeImage()
    }

    static func jpeg(_ image: CGImage, quality: Double) -> Data? {
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }
}
