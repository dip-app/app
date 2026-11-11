import DIPCore
import DIPDesignSystem
import SwiftUI

#if canImport(UIKit)
    import UIKit

    /// Draws a member's markup onto the captured screenshot and re-encodes it under the 400 KB Storage limit.
    enum ScreenshotMarkupRenderer {
        static let maximumBytes = 400 * 1024
        static let lineWidthFraction: CGFloat = 0.012

        static func render(base: Data, markup: ScreenshotMarkup) -> Data? {
            guard !markup.isEmpty, let image = UIImage(data: base) else { return nil }
            let size = image.size
            let format = UIGraphicsImageRendererFormat()
            format.scale = image.scale
            format.opaque = true
            let width = max(3, size.width * lineWidthFraction)
            let stroke = UIColor(DIPTokens.Color.actionPrimary.swiftUIColor)
            let composed = UIGraphicsImageRenderer(size: size, format: format).image { context in
                image.draw(in: CGRect(origin: .zero, size: size))
                let cg = context.cgContext
                cg.setStrokeColor(stroke.cgColor); cg.setFillColor(stroke.cgColor)
                cg.setLineWidth(width); cg.setLineCap(.round); cg.setLineJoin(.round)
                for item in markup.strokes {
                    let points = item.points.map { CGPoint(x: $0.x * size.width, y: $0.y * size.height) }
                    guard let first = points.first else { continue }
                    if points.count == 1 {
                        cg.fillEllipse(in: CGRect(x: first.x - width / 2, y: first.y - width / 2, width: width, height: width))
                    } else {
                        cg.beginPath(); cg.move(to: first)
                        points.dropFirst().forEach { cg.addLine(to: $0) }
                        cg.strokePath()
                    }
                }
            }
            for quality in [0.7, 0.5, 0.3] {
                if let data = composed.jpegData(compressionQuality: quality), data.count <= maximumBytes { return data }
            }
            return nil
        }
    }

    /// Simple flat markup step shown from the report sheet: draw with a finger, undo, clear, then Done or Cancel.
    /// Strokes are kept in unit coordinates, so what is drawn here is exactly what the renderer burns in.
    struct ScreenshotMarkupEditor: View {
        let screenshot: Data
        let onFinish: (ScreenshotMarkup?) -> Void
        @State private var markup: ScreenshotMarkup
        @Environment(\.dismiss) private var dismiss

        init(screenshot: Data, markup: ScreenshotMarkup, onFinish: @escaping (ScreenshotMarkup?) -> Void) {
            self.screenshot = screenshot; self.onFinish = onFinish; _markup = State(initialValue: markup)
        }

        private var ink: Color { DIPTokens.Color.textPrimary.swiftUIColor }
        private var accent: Color { DIPTokens.Color.actionPrimary.swiftUIColor }

        var body: some View {
            VStack(spacing: DIPTokens.Spacing.related) {
                DIPHeader(title: "Mark up screenshot")
                Text("Draw on the screenshot to point out the problem. Hide anything private by covering it.")
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                    .foregroundStyle(ink.opacity(0.72))
                    .frame(maxWidth: .infinity, alignment: .leading)
                canvas
                HStack(spacing: DIPTokens.Spacing.related) {
                    DIPButton("Undo", emphasis: .secondary, isEnabled: markup.canUndo) {
                        DIPHaptics.select(); markup.undo(); announce("Stroke removed")
                    }
                    .accessibilityIdentifier("markup.undo")
                    DIPButton("Clear", emphasis: .secondary, isEnabled: !markup.isEmpty) {
                        DIPHaptics.select(); markup.clear(); announce("Markup cleared")
                    }
                    .accessibilityIdentifier("markup.clear")
                }
                HStack(spacing: DIPTokens.Spacing.related) {
                    DIPButton("Cancel", emphasis: .secondary) { onFinish(nil); dismiss() }
                        .accessibilityIdentifier("markup.cancel")
                    DIPButton("Done") { onFinish(markup); dismiss() }
                        .accessibilityIdentifier("markup.done")
                }
            }
            .padding(.horizontal, DIPTokens.Spacing.contentInset)
            .padding(.vertical, 16)
            .background(DIPTokens.Color.surfaceDefault.swiftUIColor)
            .preferredColorScheme(.light)
            .accessibilityIdentifier("markup.editor")
        }

        @ViewBuilder private var canvas: some View {
            if let image = UIImage(data: screenshot) {
                let ratio = image.size.width / max(1, image.size.height)
                Image(uiImage: image).resizable().scaledToFit()
                    .overlay {
                        GeometryReader { proxy in
                            Canvas { context, size in
                                for item in markup.strokes {
                                    let points = item.points.map { CGPoint(x: $0.x * size.width, y: $0.y * size.height) }
                                    guard let first = points.first else { continue }
                                    let width = max(3, size.width * ScreenshotMarkupRenderer.lineWidthFraction)
                                    if points.count == 1 {
                                        context.fill(Path(ellipseIn: CGRect(x: first.x - width / 2, y: first.y - width / 2, width: width, height: width)), with: .color(accent))
                                    } else {
                                        var path = Path(); path.move(to: first); points.dropFirst().forEach { path.addLine(to: $0) }
                                        context.stroke(path, with: .color(accent), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
                                    }
                                }
                            }
                            .contentShape(Rectangle())
                            .gesture(DragGesture(minimumDistance: 0)
                                .onChanged { value in
                                    let point = MarkupPoint(x: value.location.x / max(1, proxy.size.width), y: value.location.y / max(1, proxy.size.height))
                                    // The first sample of a touch starts a stroke; later samples extend it.
                                    if drawing { markup.extend(to: point) } else { drawing = markup.begin(at: point) }
                                }
                                .onEnded { _ in drawing = false; markup.end() })
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous)
                        .strokeBorder(ink.opacity(0.12), lineWidth: 1))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .aspectRatio(ratio, contentMode: .fit)
                    // Freehand drawing has no VoiceOver equivalent; the sheet keeps the plain screenshot for that path.
                    .accessibilityElement()
                    .accessibilityLabel("Screenshot markup canvas")
                    .accessibilityHint("Drawing needs touch. Choose Cancel to send the screenshot as it is.")
                    .accessibilityIdentifier("markup.canvas")
            }
        }

        @State private var drawing = false

        private func announce(_ text: String) { AccessibilityNotification.Announcement(text).post() }
    }
#endif
