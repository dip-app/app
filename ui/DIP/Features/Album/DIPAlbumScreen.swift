import DIPCore
import DIPDesignSystem
import PhotosUI
import SwiftUI
import UIKit

/// Renders observed album records. Picker bytes and retries are transient command drafts.
struct DIPAlbumScreen: View {
    let album: DIPAlbum
    let commentsByPhoto: [String: [DIPPhotoComment]]
    let currentUser: DIPProfile
    let onAddComment: (String, String, String) async throws -> Void
    let showsBottomBar: Bool
    @Binding private var isPickerPresented: Bool
    let onBack: () -> Void
    let onAddPhotos: ([PhotoUpload]) async throws -> Void
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var viewedPhotoID: String?
    @State private var importMessage: String?
    @State private var isImporting = false
    @State private var pendingUploads: [PhotoUpload] = []

    init(
        album: DIPAlbum,
        commentsByPhoto: [String: [DIPPhotoComment]],
        currentUser: DIPProfile,
        showsBottomBar: Bool = true,
        isPickerPresented: Binding<Bool> = .constant(false),
        onBack: @escaping () -> Void,
        onAddPhotos: @escaping ([PhotoUpload]) async throws -> Void,
        onAddComment: @escaping (String, String, String) async throws -> Void
    ) {
        self.album = album
        self.commentsByPhoto = commentsByPhoto
        self.currentUser = currentUser
        self.onAddComment = onAddComment
        self.showsBottomBar = showsBottomBar
        _isPickerPresented = isPickerPresented
        self.onBack = onBack
        self.onAddPhotos = onAddPhotos
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
                            if album.photos.isEmpty {
                                DIPEmptyState(
                                    screen: "album", title: "No photos yet",
                                    message: "Photos from this event will show up here.",
                                    // Standalone, the page's own bottom picker is the add action; composed,
                                    // this opens the shell's picker through the shared binding.
                                    actionTitle: showsBottomBar ? nil : "Add photos",
                                    action: showsBottomBar ? nil : { isPickerPresented = true })
                                    .padding(.top, 8)
                            } else {
                                mosaic(width: width)
                                if album.photos.count > 12 {
                                    ForEach(12..<album.photos.count, id: \.self) { index in
                                        photoButton(album.photos[index], index: index, width: width, height: 246)
                                    }
                                }
                            }
                            if isImporting { ProgressView("Adding photos…") }
                        }
                        .padding(.horizontal, 20).padding(.bottom, 100)
                    }
                    .scrollIndicators(.hidden)
                }
                .padding(.bottom, 22)
                if showsBottomBar {
                    PhotosPicker(selection: $selectedItems, maxSelectionCount: 12, matching: .images) {
                        Text("Add Photos")
                            .font(DIPReferenceAssets.font("Figtree-Regular", size: 24))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity).frame(height: 80)
                            .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(isImporting)
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
            isPresented: $isPickerPresented, selection: $selectedItems,
            maxSelectionCount: 12, matching: .images
        )
        .fullScreenCover(item: viewedPhoto) { photo in
            photoViewer(photo)
        }
        .onChange(of: selectedItems) { _, items in
            Task { await importSelection(items) }
        }
        .alert(
            "Photo selection",
            isPresented: Binding(
                get: { importMessage != nil },
                set: { if !$0 { importMessage = nil } })
        ) {
            if !pendingUploads.isEmpty {
                Button("Try Again") { Task { await retryPendingPhotos() } }
            }
            Button("OK") { importMessage = nil }
        } message: {
            Text(importMessage ?? "")
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
        .presentationBackground(.clear)
    }

    @MainActor
    private func importSelection(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        guard !isImporting else {
            selectedItems = []
            return
        }
        isImporting = true
        importMessage = nil
        defer {
            selectedItems = []
            isImporting = false
        }
        var uploads: [PhotoUpload] = []
        var failures = 0
        for item in items {
            do {
                guard let data = try await item.loadTransferable(type: Data.self),
                    data.count <= 25_000_000, UIImage(data: data) != nil
                else {
                    failures += 1
                    continue
                }
                uploads.append(PhotoUpload(data: data))
            } catch {
                failures += 1
            }
        }
        guard !uploads.isEmpty else {
            importMessage = "The selected photos could not be opened. Choose images smaller than 25 MB."
            return
        }
        pendingUploads = uploads
        do {
            try await onAddPhotos(uploads)
            pendingUploads = []
            if failures > 0 {
                importMessage = "\(failures) selected photo(s) could not be opened. Choose images smaller than 25 MB."
            }
        } catch {
            // Retain command IDs/bytes for an idempotent retry; observed album data is unchanged here.
            importMessage = "Your photos could not be added. Try again."
        }
    }

    @MainActor
    private func retryPendingPhotos() async {
        guard !isImporting, !pendingUploads.isEmpty else { return }
        isImporting = true
        importMessage = nil
        defer { isImporting = false }
        do {
            try await onAddPhotos(pendingUploads)
            pendingUploads = []
        } catch {
            importMessage = "Your photos could not be added. Try again."
        }
    }
}
