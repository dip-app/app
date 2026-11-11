import DIPCore
import DIPDesignSystem
import PhotosUI
import SwiftUI
import UIKit

/// Renders observed album records plus the member's in-flight upload drafts (optimistic thumbnails with
/// progress, failure and retry). Published photos come only from repository observation.
struct DIPAlbumScreen: View {
    let album: DIPAlbum
    let commentsByPhoto: [String: [DIPPhotoComment]]
    let currentUser: DIPProfile
    let onAddComment: (String, String, String) async throws -> Void
    let showsBottomBar: Bool
    @Binding private var isPickerPresented: Bool
    let onBack: () -> Void
    /// The photo open in the viewer (nil when closed), so the host can observe its comments.
    let onViewPhoto: ((String?) -> Void)?
    private let injectedUploads: AlbumUploadQueue?
    @State private var ownUploads: AlbumUploadQueue
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var viewedPhotoID: String?

    init(
        album: DIPAlbum,
        commentsByPhoto: [String: [DIPPhotoComment]],
        currentUser: DIPProfile,
        showsBottomBar: Bool = true,
        initialPhotoID: String? = nil,
        isPickerPresented: Binding<Bool> = .constant(false),
        uploads: AlbumUploadQueue? = nil,
        onBack: @escaping () -> Void,
        onAddPhotos: @escaping ([PhotoUpload]) async throws -> Void,
        onAddComment: @escaping (String, String, String) async throws -> Void,
        onViewPhoto: ((String?) -> Void)? = nil
    ) {
        self.album = album
        _viewedPhotoID = State(initialValue: initialPhotoID)
        self.commentsByPhoto = commentsByPhoto
        self.currentUser = currentUser
        self.onAddComment = onAddComment
        self.showsBottomBar = showsBottomBar
        _isPickerPresented = isPickerPresented
        self.onBack = onBack
        self.onViewPhoto = onViewPhoto
        injectedUploads = uploads
        // Hosts without a shared queue (standalone previews) send each photo through `onAddPhotos`.
        _ownUploads = State(initialValue: AlbumUploadQueue(send: { _, photo, progress in
            try await onAddPhotos([photo])
            progress(1)
            return photo.id
        }))
    }

    private var uploads: AlbumUploadQueue { injectedUploads ?? ownUploads }
    private var drafts: [AlbumUploadQueue.Item] { uploads.items(for: album.eventID) }

    /// How many more photos the picker may offer (the source's limit minus drafts not yet published).
    private var selectionLimit: Int {
        guard album.canAddPhotos else { return 0 }
        guard let remaining = album.remainingUploads else { return 12 }
        return max(0, remaining - uploads.reservedCount(for: album.eventID))
    }

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width - 40
            ZStack(alignment: .top) {
                DIPTokens.Color.surfaceDefault.swiftUIColor
                VStack(spacing: 0) {
                    header
                        .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 10)
                    ScrollView {
                        VStack(spacing: 9) {
                            if !drafts.isEmpty { uploadStrip }
                            content(width: width)
                        }
                        .padding(.horizontal, 20).padding(.bottom, 100)
                    }
                    .scrollIndicators(.hidden)
                }
                .padding(.bottom, 22)
                if showsBottomBar && album.canAddPhotos {
                    PhotosPicker(selection: $selectedItems, maxSelectionCount: max(1, selectionLimit), matching: .images) {
                        Text(selectionLimit > 0 ? "Add Photos" : "Photo limit reached")
                            .font(DIPReferenceAssets.font("Figtree-Regular", size: 24))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity).frame(height: 80)
                            .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(selectionLimit == 0)
                    .accessibilityIdentifier("album.add-photos")
                    .padding(.horizontal, 20)
                    .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
                }
            }
            .clipped()
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
        .photosPicker(
            isPresented: Binding(get: { isPickerPresented && selectionLimit > 0 }, set: { isPickerPresented = $0 }),
            selection: $selectedItems, maxSelectionCount: max(1, selectionLimit), matching: .images
        )
        .fullScreenCover(item: viewedPhoto) { photo in
            photoViewer(photo)
        }
        .onChange(of: selectedItems) { _, items in importSelection(items) }
        .onChange(of: album.photos.map(\.id), initial: true) { _, ids in
            uploads.reconcile(eventID: album.eventID, publishedPhotoIDs: Set(ids))
        }
        // Not onDisappear: presenting the full-screen viewer itself makes this page disappear.
        .onChange(of: viewedPhotoID, initial: true) { _, id in onViewPhoto?(id) }
        .onAppear { if injectedUploads == nil { ownUploads.onRunFinished = Self.feelRun } }
    }

    /// Finished uploads are felt: success when every photo landed, failure when any did not.
    static func feelRun(succeeded: Int, failed: Int) {
        if failed > 0 { DIPHaptics.failure() } else if succeeded > 0 { DIPHaptics.success() }
    }

    @ViewBuilder private func content(width: CGFloat) -> some View {
        if !album.isLoaded {
            ProgressView("Loading photos…")
                .frame(maxWidth: .infinity).padding(.top, 40)
                .accessibilityIdentifier("album.loading")
        } else if album.photos.isEmpty {
            if drafts.isEmpty { emptyState.padding(.top, 8) }
        } else {
            mosaic(width: width)
            if album.photos.count > 12 {
                ForEach(12..<album.photos.count, id: \.self) { index in
                    photoButton(album.photos[index], index: index, width: width, height: 246)
                }
            }
        }
    }

    /// Shared empty-state format. The invitation to add appears only when this member may upload.
    @ViewBuilder private var emptyState: some View {
        if let error = album.loadError {
            DIPEmptyState(screen: "album-error", title: "Couldn’t load photos", message: error)
        } else if album.canAddPhotos && selectionLimit > 0 {
            // The solid Add Photos pill below is the single add action (no second button in the card).
            DIPEmptyState(screen: "album", title: "No photos yet", message: "Be the first to add one.")
        } else {
            DIPEmptyState(screen: "album", title: "No photos yet", message: "Photos from this event will show up here.")
        }
    }

    private var viewedPhoto: Binding<DIPPhoto?> {
        Binding(
            get: { album.photos.first { $0.id == viewedPhotoID } },
            set: { viewedPhotoID = $0?.id })
    }

    private var header: some View {
        HStack {
            Button(action: onBack) {
                DIPReferenceAssets.image("album_BackButton")
                    .resizable().frame(width: 50, height: 50)
                    .contentShape(Circle())
            }
            .accessibilityLabel("Back")
            .accessibilityIdentifier("album.back")
            Spacer(minLength: 0)
            ShareLink(item: album.title) {
                DIPReferenceAssets.image("album_HeroiconsMiniLink")
                    .resizable().frame(width: 20, height: 20)
                    .frame(width: 50, height: 50)
                    .background(.white, in: Circle())
                    .overlay(
                        Circle().strokeBorder(
                            Color(.sRGB, red: 124.0 / 255, green: 136.0 / 255, blue: 250.0 / 255, opacity: 1),
                            lineWidth: 2)
                    )
                    .contentShape(Circle())
            }
            .accessibilityLabel("Share album")
            .accessibilityIdentifier("album.share")
        }
        .buttonStyle(.plain)
        .frame(height: 50)
    }

    // MARK: Upload drafts

    private var uploadStrip: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(uploadStatus)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.72))
                .accessibilityIdentifier("album.upload.status")
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(Array(drafts.enumerated()), id: \.element.id) { index, item in
                        uploadTile(item, index: index)
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 6)
    }

    private var uploadStatus: String {
        let pending = uploads.pendingCount(for: album.eventID)
        let failed = uploads.failedCount(for: album.eventID)
        if pending > 0 { return pending == 1 ? "Adding 1 photo…" : "Adding \(pending) photos…" }
        if failed > 0 { return failed == 1 ? "1 photo wasn’t added." : "\(failed) photos weren’t added." }
        return "Photos added"
    }

    private func uploadTile(_ item: AlbumUploadQueue.Item, index: Int) -> some View {
        VStack(spacing: 6) {
            ZStack {
                Group {
                    if let thumbnail = item.thumbnail { DIPMedia(.data(thumbnail)).resizable().scaledToFill() }
                    else { DIPTokens.Color.surfaceMuted.swiftUIColor }
                }
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                tileOverlay(item)
            }
            .frame(width: 84, height: 84)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(tileLabel(item))
            .accessibilityIdentifier("album.upload.\(index)")
            if case .failed(let message) = item.state {
                HStack(spacing: 6) {
                    if item.upload != nil {
                        Button("Retry") { uploads.retry(item.id) }
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                            .foregroundStyle(DIPTokens.Color.textInverse.swiftUIColor)
                            .padding(.horizontal, 12).frame(height: 30)
                            .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                            .contentShape(Capsule())
                            .buttonStyle(DIPPressFeedbackStyle())
                            .accessibilityHint(message)
                            .accessibilityIdentifier("album.upload.retry.\(index)")
                    }
                    Button { uploads.remove(item.id) } label: {
                        Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(DIPTokens.Color.textInverse.swiftUIColor)
                            .frame(width: 30, height: 30)
                            .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Circle())
                            .contentShape(Circle())
                    }
                    .buttonStyle(DIPPressFeedbackStyle())
                    .accessibilityLabel("Remove photo")
                    .accessibilityIdentifier("album.upload.remove.\(index)")
                }
            }
        }
    }

    @ViewBuilder private func tileOverlay(_ item: AlbumUploadQueue.Item) -> some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        switch item.state {
        case .preparing, .waiting:
            shape.fill(.black.opacity(0.35))
            ProgressView().tint(.white)
        case .uploading(let value):
            shape.fill(.black.opacity(0.35))
            Circle().stroke(.white.opacity(0.35), lineWidth: 3).frame(width: 30, height: 30)
            Circle().trim(from: 0, to: max(0.02, value))
                .stroke(.white, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90)).frame(width: 30, height: 30)
                .animation(.linear(duration: 0.2), value: value)
        case .failed:
            shape.fill(.black.opacity(0.55))
            Image(systemName: "exclamationmark.circle.fill").font(.system(size: 24))
                .foregroundStyle(DIPTokens.Color.notificationAccent.swiftUIColor)
        case .done:
            shape.fill(.black.opacity(0.2))
            Image(systemName: "checkmark.circle.fill").font(.system(size: 24)).foregroundStyle(.white)
        }
    }

    private func tileLabel(_ item: AlbumUploadQueue.Item) -> String {
        switch item.state {
        case .preparing, .waiting: "Photo waiting to upload"
        case .uploading(let value): "Uploading photo, \(Int(value * 100)) percent"
        case .failed(let message): "Photo not added. \(message)"
        case .done: "Photo added"
        }
    }

    private func importSelection(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        selectedItems = []
        let accepted = Array(items.prefix(max(0, selectionLimit)))
        guard !accepted.isEmpty else { return }
        uploads.enqueue(eventID: album.eventID, loaders: accepted.map { item in
            { @Sendable in
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    throw AlbumImageProcessing.Failure.unreadable
                }
                return data
            }
        })
    }

    // MARK: Grid

    private func mosaic(width: CGFloat) -> some View {
        let large = (width - 10) * 237 / 352
        let small = width - 10 - large
        return VStack(spacing: 9) {
            HStack(spacing: 10) {
                photo(at: 0, width: large, height: large)
                VStack(spacing: 10) {
                    photo(at: 1, width: small, height: small)
                    photo(at: 2, width: small, height: small)
                }
                .frame(width: small, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: small * 2 + 10)
            if album.photos.count > 3 {
                HStack(spacing: 10) {
                    photo(at: 3, width: width * 69 / 362, height: 114)
                    photo(at: 4, width: width - width * 143 / 362 - 20, height: 112)
                    photo(at: 5, width: width * 74 / 362, height: 114)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 114)
            }
            if album.photos.count > 6 {
                HStack(spacing: 10) {
                    VStack(spacing: 10) {
                        photo(at: 6, width: small, height: small)
                        photo(at: 7, width: small, height: small)
                    }
                    .frame(width: small, alignment: .leading)
                    photo(at: 8, width: large, height: large)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: small * 2 + 10)
            }
            if album.photos.count > 9 {
                HStack(spacing: 10) {
                    ForEach(9..<min(12, album.photos.count), id: \.self) { index in
                        photo(at: index, width: (width - 20) / 3, height: (width - 20) / 3)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    @ViewBuilder
    private func photo(at index: Int, width: CGFloat, height: CGFloat) -> some View {
        if album.photos.indices.contains(index) {
            photoButton(album.photos[index], index: index, width: width, height: height)
        }
    }

    private func photoButton(_ photo: DIPPhoto, index: Int, width: CGFloat, height: CGFloat) -> some View {
        Button {
            viewedPhotoID = photo.id
        } label: {
            DIPMedia(photo.image).resizable()
                .scaledToFill()
                .frame(width: width, height: height)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(alignment: .topLeading) {
                    if let attribution = photo.attribution {
                        let badgeWidth = min(index == 0 ? 111.5 : 113.5, max(0, width - 13))
                        HStack(spacing: 8.04) {
                            DIPMedia(attribution.avatar).resizable().frame(width: 22, height: 22)
                            Text(attribution.name)
                                .font(DIPReferenceAssets.font("Figtree-Regular", size: 10.435))
                                .foregroundStyle(.black)
                                .lineLimit(1)
                        }
                        .padding(.leading, 5).padding(.trailing, 10)
                        .frame(width: badgeWidth, height: 30, alignment: .leading)
                        .background(.white, in: Capsule())
                        .offset(x: max(0, width - badgeWidth - 6.5), y: height - 36.5)
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: 20))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            photo.attribution.map { "Open photo by \($0.name)" } ?? "Open album photo \(index + 1)"
        )
        .accessibilityIdentifier("album.photo.\(index)")
        .id(photo.id)
    }

    private func photoViewer(_ photo: DIPPhoto) -> some View {
        DIPPhotoCommentsScreen(
            photo: photo, comments: commentsByPhoto[photo.id] ?? [],
            currentUser: currentUser, onClose: { viewedPhotoID = nil },
            onAddComment: onAddComment
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("photo.viewer.\(photo.id)")
        .presentationBackground(.clear)
    }
}
