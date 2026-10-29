import DIPDesignSystem
import PhotosUI
import SwiftUI
import UIKit

/// Original album mosaic, with local-only photo selection for presentation review.
/// Uploaded media and album authorization remain separate backend work.
struct DIPAlbumScreen: View {
    let onBack: () -> Void
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var importedPhotos: [Photo] = []
    @State private var viewedPhoto: Photo?
    @State private var importMessage: String?

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
                            mosaic(width: width)
                            ForEach(importedPhotos) { photo in
                                photoButton(photo, width: width, height: 246)
                            }
                            if !importedPhotos.isEmpty {
                                Text("Added on this device only")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.horizontal, 20).padding(.bottom, 100)
                    }
                    .scrollIndicators(.hidden)
                }
                .padding(.bottom, 22)
                PhotosPicker(selection: $selectedItems, maxSelectionCount: 12, matching: .images) {
                    Text("Add Photos")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 24))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity).frame(height: 80)
                        .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("album.add-photos")
                .padding(.horizontal, 20)
                .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
            }
            .clipped()
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
        .fullScreenCover(item: $viewedPhoto) { photo in
            photoViewer(photo)
        }
        .onChange(of: selectedItems) { _, items in
            Task { await importSelection(items) }
        }
        .alert(
            "Photo selection",
            isPresented: Binding(
                get: { importMessage != nil },
                set: { if !$0 { importMessage = nil } }
            )
        ) {
            Button("OK") { importMessage = nil }
        } message: {
            Text(importMessage ?? "")
        }
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
            ShareLink(item: "Photos from our DIP event") {
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
                photoButton(
                    .reference[0], width: large, height: large, attribution: ("Jane Gertskey", "album_AvatarPurple"))
                VStack(spacing: 10) {
                    photoButton(.reference[1], width: small, height: small)
                    photoButton(.reference[2], width: small, height: small)
                }
            }
            .frame(height: small * 2 + 10)
            HStack(spacing: 10) {
                photoButton(.reference[3], width: width * 69 / 362, height: 114)
                photoButton(.reference[4], width: width - width * 143 / 362 - 20, height: 112)
                photoButton(.reference[5], width: width * 74 / 362, height: 114)
            }
            .frame(height: 114)
            HStack(spacing: 10) {
                VStack(spacing: 10) {
                    photoButton(.reference[6], width: small, height: small)
                    photoButton(.reference[7], width: small, height: small)
                }
                photoButton(
                    .reference[8], width: large, height: large, attribution: ("Alexis Standall", "album_AvatarTeal"))
            }
            .frame(height: small * 2 + 10)
            HStack(spacing: 10) {
                ForEach(Array(Photo.reference[9...11])) { photo in
                    photoButton(photo, width: (width - 20) / 3, height: (width - 20) / 3)
                }
            }
        }
    }

    private func photoButton(
        _ photo: Photo, width: CGFloat, height: CGFloat,
        attribution: (String, String)? = nil
    ) -> some View {
        Button {
            viewedPhoto = photo
        } label: {
            photoImage(photo)
                .scaledToFill()
                .frame(width: width, height: height)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(alignment: .topLeading) {
                    if let (name, avatar) = attribution {
                        HStack(spacing: 8.04) {
                            DIPReferenceAssets.image(avatar)
                                .resizable().frame(width: 22, height: 22)
                            Text(name)
                                .font(DIPReferenceAssets.font("Figtree-Regular", size: 10.435))
                                .foregroundStyle(.black)
                        }
                        .padding(.leading, 5).padding(.trailing, 10)
                        .frame(width: photo.id == 0 ? 111.5 : 113.5, height: 30, alignment: .leading)
                        .background(.white, in: Capsule())
                        .offset(x: photo.id == 0 ? 119 : 117, y: height - 36.5)
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: 20))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(attribution.map { "Open photo by \($0.0)" } ?? "Open album photo \(photo.id + 1)")
        .accessibilityIdentifier("album.photo.\(photo.id)")
    }

    private func photoImage(_ photo: Photo) -> Image {
        if let asset = photo.asset { return DIPReferenceAssets.image(asset).resizable() }
        if let data = photo.data, let image = UIImage(data: data) { return Image(uiImage: image).resizable() }
        return Image(systemName: "photo").resizable()
    }

    private func photoViewer(_ photo: Photo) -> some View {
        NavigationStack {
            photoImage(photo)
                .scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { viewedPhoto = nil }
                            .accessibilityIdentifier("album.photo.close")
                    }
                }
                .toolbarBackground(.black, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
        }
        .tint(.white)
    }

    @MainActor
    private func importSelection(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        var failed = 0
        for item in items {
            do {
                guard let data = try await item.loadTransferable(type: Data.self),
                    data.count <= 25_000_000, UIImage(data: data) != nil
                else {
                    failed += 1
                    continue
                }
                importedPhotos.append(Photo(id: 12 + importedPhotos.count, asset: nil, data: data))
            } catch {
                failed += 1
            }
        }
        selectedItems = []
        if failed > 0 {
            importMessage = "\(failed) selected photo(s) could not be opened. Choose an image smaller than 25 MB."
        }
    }

    private struct Photo: Identifiable {
        let id: Int
        let asset: String?
        let data: Data?

        static let reference: [Self] = [
            "Rectangle931", "Rectangle933", "Rectangle934", "Rectangle932",
            "Rectangle935", "Rectangle936", "Rectangle937", "Rectangle938",
            "Rectangle939", "Rectangle940", "Rectangle935", "Rectangle941",
        ].enumerated().map { .init(id: $0.offset, asset: "album_\($0.element)", data: nil) }
    }
}
