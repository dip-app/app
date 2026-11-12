import DIPCore
import DIPDesignSystem
import SwiftUI

/// Floating photo annotations rendered from repository observation.
///
/// Compact comment bubbles float over the photo at deterministic positions (`DIPPhotoCommentPlacement`): outer thirds,
/// inset from the edges, no overlap, at most five with a "+N" pill that opens the full list.
struct DIPPhotoCommentsScreen: View {
    let photo: DIPPhoto
    let comments: [DIPPhotoComment]
    let currentUser: DIPProfile
    let onClose: () -> Void
    let onAddComment: (String, String, String) async throws -> Void
    /// 1-based place in the album (nil for a single photo) and the previous/next stepper (-1 / +1).
    var position: (index: Int, count: Int)?
    var onStep: ((Int) -> Void)?
    /// +1 when the last step went forward, -1 backward: the photo slides in from that side.
    var direction = 1
    /// Saving to Photos (nil hides the Save control); `loadOriginal` reads the stored bytes with the signed-in session.
    var saver: AlbumPhotoSaver?
    var eventID = ""
    var loadOriginal: (@MainActor (String) async throws -> Data)?

    @State private var toast: String?
    @State private var toastTask: Task<Void, Never>?
    @State private var showsPermissionAlert = false
    @Environment(\.openURL) private var openURL
    @State private var draft = ""
    @State private var retryIntent: SendIntent?
    @State private var isSending = false
    @State private var sendError: String?
    @State private var composerFocused = false
    @State private var selectedCommentID: String?
    @State private var showsAllComments = false
    @State private var bubblesShown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct SendIntent {
        let id: String
        let text: String
    }

    static let photoHeight: CGFloat = 262

    var body: some View {
        GeometryReader { geometry in
            let belowComposer = composerFocused ? 12 : max(0, (geometry.size.height - 358) / 2)
            ZStack(alignment: .topLeading) {
                // A plain dark scrim (no blur, nearly opaque so the album behind does not show through) keeps the photo and controls readable.
                ZStack {
                    Color.black.opacity(0.94)
                    // Fully opaque toward the bottom so the album's Add Photos bar never ghosts under the composer.
                    LinearGradient(colors: [.black.opacity(0), .black], startPoint: UnitPoint(x: 0.5, y: 0.6), endPoint: UnitPoint(x: 0.5, y: 0.8))
                }
                .ignoresSafeArea()
                    .onTapGesture { selectedCommentID = nil }
                VStack(spacing: 12) {
                    Spacer(minLength: 0)
                    photoPreview(width: geometry.size.width)
                        .id(photo.id)
                        .transition(photoTransition)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            }
            .safeAreaInset(edge: .bottom, spacing: 16) {
                composer(width: geometry.size.width)
                    .padding(.bottom, belowComposer)
            }
            .overlay(alignment: .topLeading) {
                closeButton.padding(.leading, 20).padding(.top, 60)
            }
            .overlay(alignment: .topTrailing) {
                if position != nil || saver != nil { controlBar.padding(.trailing, 20).padding(.top, 60) }
            }
            .overlay(alignment: .top) {
                if let toast { toastView(toast).padding(.top, 118).transition(.opacity.combined(with: .move(edge: .top))) }
            }
        }
        .ignoresSafeArea(.container)
        // Dark scheme: the status bar (clock, battery) turns light over the black scrim. Every control sets its own colours.
        .preferredColorScheme(.dark)
        .accessibilityElement(children: .contain)
        .sheet(isPresented: $showsAllComments) { allComments.preferredColorScheme(.light) }
        .onAppear { bubblesShown = true }
        .onChange(of: photo.id) { _, _ in
            // A new photo starts clean: no expanded comment, draft or stale error from the previous one.
            selectedCommentID = nil; draft = ""; sendError = nil; retryIntent = nil
        }
        .alert("Allow saving photos", isPresented: $showsPermissionAlert) {
            Button("Open Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
            Button("Not Now", role: .cancel) {}
        } message: {
            Text("DIP needs permission to add photos to your library. You can turn it on in Settings.")
        }
    }

    /// The same yellow back control as the event page (50 pt); closes the viewer.
    private var closeButton: some View {
        Button(action: onClose) {
            DIPReferenceAssets.image("event_BackButton").resizable()
                .frame(width: 50, height: 50)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close photo")
        .accessibilityIdentifier("album.photo.close")
    }

    /// One 50 pt white capsule (the height of the back button) in the top right: [ < ]  3/12  [ > ] | save. White with ink and purple glyphs: it reads on the dark scrim.
    private var controlBar: some View {
        HStack(spacing: 0) {
            if let position, let onStep {
                barButton("chevron.left", label: "Previous photo", id: "album.photo.previous", enabled: position.index > 1) { onStep(-1) }
                Text(DIPPhotoCount.text(index: position.index, count: position.count))
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 16, relativeTo: .body).weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(width: DIPPhotoCount.labelWidth(count: position.count))
                    .accessibilityLabel(DIPPhotoCount.spoken(index: position.index, count: position.count))
                    .accessibilityIdentifier("album.photo.position")
                barButton("chevron.right", label: "Next photo", id: "album.photo.next", enabled: position.index < position.count) { onStep(1) }
            }
            if saver != nil {
                if position != nil { Rectangle().fill(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.15)).frame(width: 1, height: 22) }
                saveButton
            }
        }
        .background(.white, in: Capsule())
        .frame(height: 50)
    }

    private func barButton(_ symbol: String, label: String, id: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 16, weight: .semibold))
                .foregroundStyle(enabled ? DIPTokens.Color.actionPrimary.swiftUIColor : Color(red: 0xB8 / 255, green: 0xBA / 255, blue: 0xC4 / 255))
                .frame(width: 46, height: 50)
                .contentShape(Rectangle())
        }
        .buttonStyle(BarPressStyle())
        .disabled(!enabled)
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
    }

    @ViewBuilder private var saveButton: some View {
        let saved = saver?.isSaved(eventID: eventID, photoID: photo.id) == true
        let saving = saver?.isSaving(eventID: eventID, photoID: photo.id) == true
        Button(action: savePhoto) {
            Group {
                if saving { ProgressView().tint(DIPTokens.Color.actionPrimary.swiftUIColor) }
                else { Image(systemName: saved ? "checkmark" : "arrow.down.to.line").font(.system(size: 16, weight: .semibold)) }
            }
            .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
            .frame(width: 50, height: 50)
            .contentShape(Rectangle())
        }
        .buttonStyle(BarPressStyle())
        .disabled(saving)
        .accessibilityLabel(saved ? "Saved to Photos" : "Save photo")
        .accessibilityHint(saved ? "" : "Saves this photo to your Photos library")
        .accessibilityIdentifier("album.photo.save")
    }

    /// Pressed: scale 0.95 and a brief tint. Stepping is navigation, so there is no haptic.
    private struct BarPressStyle: ButtonStyle {
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .background(Circle().fill(DIPTokens.Color.actionPrimary.swiftUIColor.opacity(configuration.isPressed ? 0.14 : 0)).padding(4))
                .scaleEffect(configuration.isPressed && !reduceMotion ? 0.95 : 1)
                .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
        }
    }

    /// Slides in the direction of travel with a slight fade and scale; Reduce Motion cross-fades.
    private var photoTransition: AnyTransition {
        if reduceMotion { return .opacity }
        let edge: Edge = direction >= 0 ? .trailing : .leading
        return .asymmetric(
            insertion: .move(edge: edge).combined(with: .opacity).combined(with: .scale(scale: 0.96)),
            removal: .move(edge: edge == .trailing ? .leading : .trailing).combined(with: .opacity).combined(with: .scale(scale: 0.96)))
    }

    private func toastView(_ text: String) -> some View {
        Text(text)
            .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body)).foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
            .multilineTextAlignment(.center).padding(.horizontal, 20).padding(.vertical, 12).frame(minHeight: 44)
            .background(.white, in: Capsule())
            .padding(.horizontal, 20)
            .accessibilityIdentifier("photo.toast")
    }

    private func show(toast message: String) {
        toastTask?.cancel()
        withAnimation(reduceMotion ? .linear(duration: 0.15) : .spring(response: 0.35, dampingFraction: 0.85)) { toast = message }
        UIAccessibility.post(notification: .announcement, argument: message)
        toastTask = Task {
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.2)) { toast = nil }
        }
    }

    private func savePhoto() {
        guard let saver else { return }
        let id = photo.id, event = eventID, photo = photo
        Task {
            let outcome = await saver.save(eventID: event, photoID: id) { photoID in
                if let loadOriginal { return try await loadOriginal(photoID) }
                return try await AlbumPhotoSaver.fallbackData(for: photo)
            }
            switch outcome {
            case .saved: DIPHaptics.success(); show(toast: "Saved to Photos")
            case .alreadySaved: show(toast: "Already saved to Photos")
            case .denied: DIPHaptics.failure(); showsPermissionAlert = true
            case .failed(let message): DIPHaptics.failure(); show(toast: message)
            }
        }
    }

    private func photoPreview(width: CGFloat) -> some View {
        let photoTop: CGFloat = photo.attribution == nil ? 0 : 25
        let photoWidth = max(0, width - 28)
        return ZStack(alignment: .top) {
            DIPMedia(photo.image).resizable().scaledToFill()
                .frame(width: photoWidth, height: Self.photoHeight)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .accessibilityLabel("Photo")
                .accessibilityIdentifier("photo.comments.image")
                .contentShape(RoundedRectangle(cornerRadius: 20))
                .onTapGesture { selectedCommentID = nil }
                // Swiping across the photo steps to the next or previous photo.
                .gesture(DragGesture(minimumDistance: 30).onEnded { value in
                    guard abs(value.translation.width) > abs(value.translation.height) else { return }
                    onStep?(value.translation.width < 0 ? 1 : -1)
                })
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
            commentPills(width: width, photoWidth: photoWidth, photoTop: photoTop)
                .zIndex(2)
        }
        .frame(width: width, height: photoTop + Self.photoHeight)
        .onChange(of: comments.map(\.id)) { _, ids in
            if let selectedCommentID, !ids.contains(selectedCommentID) { self.selectedCommentID = nil }
        }
    }

    private func commentPills(width: CGFloat, photoWidth: CGFloat, photoTop: CGFloat) -> some View {
        let size = CGSize(width: photoWidth, height: Self.photoHeight)
        let tag = photo.attribution == nil ? [] : [CGRect(x: size.width / 2 - 110, y: 0, width: 220, height: 30)]
        let layout = DIPPhotoCommentPlacement.layout(ids: comments.map(\.id), photo: size, reserved: tag)
        let byID = Dictionary(comments.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let origin = CGPoint(x: (width - photoWidth) / 2, y: photoTop)
        return ZStack(alignment: .topLeading) {
            ForEach(Array(layout.items.enumerated()), id: \.element.id) { index, item in
                if let comment = byID[item.id] {
                    bubble(comment, index: index)
                        .position(x: origin.x + item.center.x, y: origin.y + item.center.y)
                        .opacity(bubblesShown || reduceMotion ? 1 : 0)
                        .scaleEffect(bubblesShown || reduceMotion ? 1 : 0.8)
                        .animation(reduceMotion ? .easeIn(duration: 0.2)
                                   : .spring(response: 0.45, dampingFraction: 0.78).delay(Double(index) * 0.05), value: bubblesShown)
                        .zIndex(selectedCommentID == comment.id ? 1 : 0)
                }
            }
            if layout.overflowCount > 0, let center = layout.overflowCenter {
                overflowPill(layout.overflowCount)
                    .position(x: origin.x + center.x, y: origin.y + center.y)
            }
            if let selected = comments.first(where: { $0.id == selectedCommentID }), layout.items.contains(where: { $0.id == selected.id }) {
                DIPPhotoCommentBubble(
                    text: selected.text, authorName: selected.authorName, isExpanded: true,
                    avatar: { DIPMedia(selected.authorAvatar) }
                )
                .contentShape(RoundedRectangle(cornerRadius: 20))
                .onTapGesture { } // Keep taps inside the bubble from collapsing it.
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("photo.comments.expanded.\(selected.id)")
                .accessibilityAction(named: Text("Collapse comment")) { selectedCommentID = nil }
                .position(x: width / 2, y: photoTop + Self.photoHeight / 2)
                .zIndex(3)
            }
        }
        .frame(width: width, height: photoTop + Self.photoHeight, alignment: .topLeading)
    }

    @ViewBuilder private func bubble(_ comment: DIPPhotoComment, index: Int) -> some View {
        if selectedCommentID == comment.id {
            Color.clear.frame(width: 134, height: 44)
        } else {
            Button {
                selectedCommentID = comment.id
            } label: {
                DIPPhotoCommentBubble(
                    text: comment.text, authorName: comment.authorName,
                    avatar: { DIPMedia(comment.authorAvatar) }
                )
                .frame(width: 134, height: 32, alignment: .center)
                .frame(height: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(comment.authorName): \(comment.text)")
            .accessibilityHint("Expand comment")
            .accessibilityIdentifier("photo.comments.comment.\(comment.id)")
        }
    }

    /// "+N" opens the full list. Pressable, so solid.
    private func overflowPill(_ count: Int) -> some View {
        Button { showsAllComments = true } label: {
            Text("+\(count)")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 16, relativeTo: .body).weight(.medium))
                .foregroundStyle(.white)
                .frame(width: 56, height: 32)
                .background(DIPTokens.Color.textPrimary.swiftUIColor, in: Capsule())
                .frame(height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(count) more comments")
        .accessibilityHint("Shows all comments")
        .accessibilityIdentifier("photo.comments.more")
    }

    /// Every comment, newest last, in a plain list sheet.
    private var allComments: some View {
        NavigationStack {
            List(comments) { comment in
                HStack(alignment: .top, spacing: 12) {
                    DIPMedia(comment.authorAvatar).frame(width: 32, height: 32).clipShape(Circle()).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(comment.authorName).font(DIPReferenceAssets.font("Figtree-Regular", size: 15, relativeTo: .subheadline).weight(.medium))
                        Text(comment.text).font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(comment.authorName): \(comment.text)")
            }
            .listStyle(.plain)
            .navigationTitle("Comments")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showsAllComments = false } } }
            .accessibilityIdentifier("photo.comments.all")
        }
        .presentationDetents([.medium, .large])
    }

    private func composer(width: CGFloat) -> some View {
        DIPMessageComposer(
            text: $draft, placeholder: "Add your thoughts in a comment",
            isSending: isSending, errorMessage: sendError,
            identifierPrefix: "photo.comments", style: .photoOverlay,
            avatar: { DIPMedia(currentUser.avatar) },
            sendIcon: {
                Image(systemName: "arrow.up").font(.system(size: 20, weight: .semibold))
            },
            onSend: send,
            onFocusChange: { composerFocused = $0 }
        )
        .frame(width: max(0, width - 40))
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
