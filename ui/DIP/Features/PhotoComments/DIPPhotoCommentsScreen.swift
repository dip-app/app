import DIPCore
import DIPDesignSystem
import SwiftUI

/// Floating photo annotations rendered from repository observation.
struct DIPPhotoCommentsScreen: View {
    let photo: DIPPhoto
    let comments: [DIPPhotoComment]
    let currentUser: DIPProfile
    let onClose: () -> Void
    let onAddComment: (String, String, String) async throws -> Void
    /// 1-based place in the album (nil for a single photo) and the previous/next stepper (-1 / +1).
    var position: (index: Int, count: Int)?
    var onStep: ((Int) -> Void)?

    @State private var draft = ""
    @State private var retryIntent: SendIntent?
    @State private var isSending = false
    @State private var sendError: String?
    @State private var composerFocused = false
    @State private var selectedCommentID: String?
    @State private var commentPage = 0
    @State private var olderPageEnd: String?

    private struct SendIntent {
        let id: String
        let text: String
    }

    var body: some View {
        GeometryReader { geometry in
            let belowComposer = composerFocused ? 32 : max(0, (geometry.size.height - 358) / 2)
            ZStack(alignment: .topLeading) {
                Rectangle().fill(.ultraThinMaterial)
                    .overlay(.black.opacity(0.3))
                    .ignoresSafeArea()
                    .onTapGesture { selectedCommentID = nil }
                VStack(spacing: 12) {
                    Spacer(minLength: 0)
                    photoPreview(width: geometry.size.width)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            }
            .safeAreaInset(edge: .bottom, spacing: 21) {
                composer(width: geometry.size.width)
                    .padding(.bottom, belowComposer)
            }
            .overlay(alignment: .topLeading) {
                closeButton.padding(.leading, 20).padding(.top, 60)
            }
            .overlay(alignment: .topTrailing) {
                if let position, let onStep { stepper(position, onStep).padding(.trailing, 20).padding(.top, 60) }
            }
        }
        .ignoresSafeArea(.container)
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
    }

    private var visibleComments: [DIPPhotoComment] {
        let end = olderPageEnd.flatMap { id in comments.firstIndex { $0.id == id }.map { $0 + 1 } }
            ?? max(0, comments.count - commentPage * 4)
        return Array(comments[max(0, end - 4)..<end])
    }

    private func changeCommentPage(by offset: Int) {
        commentPage = min(max(0, commentPage + offset), max(0, (comments.count - 1) / 4))
        olderPageEnd = commentPage == 0 ? nil : comments.dropLast(commentPage * 4).last?.id
        selectedCommentID = nil
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark").font(.system(size: 20, weight: .regular))
                .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                .frame(width: 50, height: 50)
                .background(.white, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .accessibilityLabel("Close photo")
        .accessibilityIdentifier("album.photo.close")
    }

    /// Previous/next photo (solid, pressable) around a plain "3 of 12" position. Disabled at either end.
    private func stepper(_ position: (index: Int, count: Int), _ onStep: @escaping (Int) -> Void) -> some View {
        HStack(spacing: 8) {
            stepButton("chevron.left", label: "Previous photo", id: "album.photo.previous", enabled: position.index > 1) { onStep(-1) }
            Text("\(position.index) of \(position.count)")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 16, relativeTo: .body))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.4), radius: 2)
                .accessibilityLabel("Photo \(position.index) of \(position.count)")
                .accessibilityIdentifier("album.photo.position")
            stepButton("chevron.right", label: "Next photo", id: "album.photo.next", enabled: position.index < position.count) { onStep(1) }
        }
    }

    private func stepButton(_ symbol: String, label: String, id: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 18, weight: .semibold))
                .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                .frame(width: 44, height: 44)
                .background(.white, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .disabled(!enabled).opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
    }

    private func photoPreview(width: CGFloat) -> some View {
        let photoTop: CGFloat = photo.attribution == nil ? 0 : 25
        return ZStack(alignment: .top) {
            DIPMedia(photo.image).resizable().scaledToFill()
                .frame(width: max(0, width - 28), height: 262)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .accessibilityLabel("Photo")
                .accessibilityIdentifier("photo.comments.image")
                .contentShape(RoundedRectangle(cornerRadius: 20))
                .onTapGesture { selectedCommentID = nil }
                .gesture(DragGesture(minimumDistance: 30).onEnded { value in
                    guard abs(value.translation.width) > abs(value.translation.height) else { return }
                    changeCommentPage(by: value.translation.width < 0 ? 1 : -1)
                })
                .accessibilityHint("Swipe left for earlier comments or right for newer comments")
                .accessibilityAction(named: Text("Earlier comments")) { changeCommentPage(by: 1) }
                .accessibilityAction(named: Text("Newer comments")) { changeCommentPage(by: -1) }
                .accessibilityAction(named: Text("Next photo")) { onStep?(1) }
                .accessibilityAction(named: Text("Previous photo")) { onStep?(-1) }
                .padding(.top, photoTop)
            if let attribution = photo.attribution {
                DIPPhotoAttributionTag(name: attribution.name) {
                    DIPMedia(attribution.avatar)
                }
                .frame(height: 50)
                .zIndex(1)
            }
            commentPills(width: width, photoTop: photoTop)
                .zIndex(2)
        }
        .frame(width: width, height: photoTop + 262)
        .onChange(of: visibleComments.map(\.id)) { _, ids in
            if let selectedCommentID, !ids.contains(selectedCommentID) {
                self.selectedCommentID = nil
            }
        }
    }

    private func commentPills(width: CGFloat, photoTop: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(Array(visibleComments.enumerated()), id: \.element.id) { index, comment in
                if selectedCommentID == comment.id {
                    DIPPhotoCommentBubble(
                        text: comment.text, authorName: comment.authorName, isExpanded: true,
                        avatar: { DIPMedia(comment.authorAvatar) }
                    )
                    .contentShape(RoundedRectangle(cornerRadius: 20))
                    .onTapGesture { } // Keep taps inside the bubble from collapsing it.
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("photo.comments.expanded.\(comment.id)")
                    .accessibilityAction(named: Text("Collapse comment")) { selectedCommentID = nil }
                    .position(x: width / 2, y: photoTop + 131)
                    .zIndex(1)
                } else {
                    Button {
                        selectedCommentID = comment.id
                    } label: {
                        DIPPhotoCommentBubble(
                            text: comment.text, authorName: comment.authorName,
                            avatar: { DIPMedia(comment.authorAvatar) }
                        )
                        .frame(
                            width: 134, height: 32,
                            alignment: index.isMultiple(of: 2) ? .leading : .trailing)
                        .frame(height: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(comment.authorName): \(comment.text)")
                    .accessibilityHint("Expand comment")
                    .accessibilityIdentifier("photo.comments.comment.\(comment.id)")
                    .position(
                        x: index.isMultiple(of: 2) ? 73 : width - 73,
                        y: photoTop + (index < 2 ? 258 : 44))
                }
            }
        }
        .frame(width: width, height: photoTop + 262, alignment: .topLeading)
    }

    private func composer(width: CGFloat) -> some View {
        DIPMessageComposer(
            text: $draft, placeholder: "Add your thoughts in a comment",
            isSending: isSending, errorMessage: sendError,
            identifierPrefix: "photo.comments", style: .photoOverlay,
            avatar: { DIPMedia(currentUser.avatar) },
            sendIcon: {
                DIPReferenceAssets.image("event_HeroiconsOutlineChatBubbleOvalLeft").resizable()
            },
            onSend: send,
            onFocusChange: { composerFocused = $0 }
        )
        .frame(width: max(0, width - 52))
        .onChange(of: draft) { _, _ in sendError = nil }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isSending, !text.isEmpty, draft.count <= DIPMessageComposer.maximumLength else { return }
        let intent =
            retryIntent.flatMap { $0.text == text ? $0 : nil }
            ?? SendIntent(id: UUID().uuidString, text: text)
        retryIntent = intent
        isSending = true
        sendError = nil
        Task { @MainActor in
            defer { isSending = false }
            do {
                try await onAddComment(photo.id, intent.id, intent.text)
                // Only repository observation adds comments; preserve text entered during the request.
                if draft.trimmingCharacters(in: .whitespacesAndNewlines) == intent.text { draft = "" }
                retryIntent = nil
                commentPage = 0
                olderPageEnd = nil
            } catch {
                // The same ID/text pair survives failure; editing starts a new intent on the next send.
                sendError = Self.sendErrorMessage(for: error)
            }
        }
    }

    /// Comment failures say what to do: offline/unavailable keeps the draft, and an unchanged retry reuses its id.
    nonisolated static func sendErrorMessage(for error: Error) -> String {
        if (error as? URLError)?.code == .notConnectedToInternet { return "You’re offline. Your comment is kept; try again when you’re back online." }
        if let failure = error as? DIPRepositoryError, case .invalidInput(let message) = failure, !message.isEmpty { return message }
        return "Your comment could not be sent. Try again."
    }
}
