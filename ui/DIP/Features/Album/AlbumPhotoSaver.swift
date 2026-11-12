import DIPCore
import DIPDesignSystem
import Foundation
import Observation
import Photos
import SwiftUI
import UIKit

/// Writes image bytes to the member's Photos library with add-only access. A seam so the saver's rules are testable.
protocol PhotoLibraryWriting: Sendable {
    /// True when add access is (or becomes) granted; false when denied or restricted. Prompts once when undetermined.
    func requestAddAccess() async -> Bool
    func write(_ data: Data) async throws
}

struct SystemPhotoLibrary: PhotoLibraryWriting {
    func requestAddAccess() async -> Bool {
        switch PHPhotoLibrary.authorizationStatus(for: .addOnly) {
        case .authorized, .limited: return true
        case .notDetermined:
            let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            return status == .authorized || status == .limited
        default: return false
        }
    }

    func write(_ data: Data) async throws {
        try await PHPhotoLibrary.shared().performChanges {
            // The stored copy is already a location-free JPEG; it is saved as is, never re-encoded.
            PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
        }
    }
}

enum PhotoSaveOutcome: Equatable {
    case saved, alreadySaved, denied
    case failed(String)
}

/// Saves album photos to the Photos library, one or all, tracking what was already saved in this session.
/// Photos are loaded by the caller through the signed-in Storage session (`load`); nothing here touches a public URL.
@MainActor @Observable final class AlbumPhotoSaver {
    typealias Loader = @MainActor (String) async throws -> Data

    private(set) var savedKeys: Set<String> = []
    private(set) var savingKey: String?
    private(set) var progress: DIPAlbumSaveProgress?
    private(set) var isSavingAll = false
    /// Finished-run summary and whether the run stopped because access was denied (the screen reacts once).
    private(set) var lastRunSummary: String?
    private(set) var lastRunDenied = false
    @ObservationIgnored private let library: PhotoLibraryWriting
    @ObservationIgnored private var run: Task<Void, Never>?

    init(library: PhotoLibraryWriting = SystemPhotoLibrary()) { self.library = library }

    static func key(eventID: String, photoID: String) -> String { "\(eventID)/\(photoID)" }
    func isSaved(eventID: String, photoID: String) -> Bool { savedKeys.contains(Self.key(eventID: eventID, photoID: photoID)) }
    func isSaving(eventID: String, photoID: String) -> Bool { savingKey == Self.key(eventID: eventID, photoID: photoID) }
    func clearRunResult() { lastRunSummary = nil; lastRunDenied = false }

    /// One photo. A photo already saved in this session is not written twice.
    func save(eventID: String, photoID: String, load: Loader) async -> PhotoSaveOutcome {
        let key = Self.key(eventID: eventID, photoID: photoID)
        if savedKeys.contains(key) { return .alreadySaved }
        guard savingKey == nil, !isSavingAll else { return .failed("Another save is in progress") }
        savingKey = key
        defer { savingKey = nil }
        guard await library.requestAddAccess() else { return .denied }
        do {
            let data = try await load(photoID)
            try await library.write(data)
            savedKeys.insert(key)
            return .saved
        } catch is CancellationError {
            return .failed("Stopped")
        } catch {
            return .failed(Self.message(for: error))
        }
    }

    /// Every photo not yet saved in this session, one after another, with progress; `cancelAll` stops after the current one.
    func saveAll(eventID: String, photoIDs: [String], load: @escaping Loader) {
        guard !isSavingAll, savingKey == nil else { return }
        clearRunResult()
        let plan = DIPAlbumSaveProgress.plan(
            photoIDs: photoIDs,
            alreadySaved: Set(photoIDs.filter { savedKeys.contains(Self.key(eventID: eventID, photoID: $0)) }))
        var state = DIPAlbumSaveProgress(total: plan.toSave.count, skipped: plan.skipped)
        guard !plan.toSave.isEmpty else { lastRunSummary = state.summary; return }
        isSavingAll = true
        progress = state
        run = Task { [weak self] in
            guard let self else { return }
            guard await self.library.requestAddAccess() else {
                self.finish(state, denied: true); return
            }
            for id in plan.toSave {
                if Task.isCancelled { state.cancel(); break }
                do {
                    let data = try await load(id)
                    try await self.library.write(data)
                    self.savedKeys.insert(Self.key(eventID: eventID, photoID: id))
                    state.recordSaved()
                } catch is CancellationError {
                    state.cancel(); break
                } catch {
                    state.recordFailed(id)
                }
                self.progress = state
            }
            self.finish(state, denied: false)
        }
    }

    func cancelAll() { run?.cancel() }

    private func finish(_ state: DIPAlbumSaveProgress, denied: Bool) {
        isSavingAll = false
        progress = nil
        run = nil
        lastRunDenied = denied
        lastRunSummary = denied ? nil : state.summary
    }

    nonisolated static func message(for error: Error) -> String {
        if (error as? URLError)?.code == .notConnectedToInternet { return "You’re offline. Try again when you’re back online." }
        return "Couldn’t save this photo. Try again."
    }

    /// Bytes for hosts without a Storage-backed loader (previews and fixtures): the photo as shown.
    static func fallbackData(for photo: DIPPhoto) async throws -> Data {
        switch photo.image {
        case .data(let data) where !data.isEmpty: return data
        case .asset(let name):
            let renderer = ImageRenderer(content: DIPReferenceAssets.image(name).resizable().scaledToFit().frame(width: 1024))
            renderer.scale = 1
            if let data = renderer.uiImage?.jpegData(compressionQuality: 0.9) { return data }
        default: break
        }
        throw DIPRepositoryError.notFound("This photo can’t be saved right now")
    }
}
