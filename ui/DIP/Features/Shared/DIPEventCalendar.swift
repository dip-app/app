import DIPCore
import EventKit
import EventKitUI
import SwiftUI
import UIKit

private struct EventCalendarAdderKey: EnvironmentKey {
    static let defaultValue: any DIPEventCalendarAdding = DIPEventKitCalendarAdder()
}

extension EnvironmentValues {
    /// The calendar adapter; previews and tests inject a fake.
    var eventCalendarAdder: any DIPEventCalendarAdding {
        get { self[EventCalendarAdderKey.self] }
        set { self[EventCalendarAdderKey.self] = newValue }
    }
}

/// Presents the system event editor. EKEventEditViewController runs out of process on iOS 17, so it
/// needs no calendar permission; the user reviews and saves (or cancels) the event themselves.
///
/// The result always resumes exactly once: saved, cancelled (Cancel, or swiping the sheet down), or failed when
/// the editor could not be presented (for example an alert or another sheet kept the screen busy for too long).
struct DIPEventKitCalendarAdder: DIPEventCalendarAdding {
    @MainActor func add(_ fields: DIPCalendarEventFields) async -> DIPCalendarAddResult {
        guard let presenter = await Self.stablePresenter() else { return .failed("Couldn’t open the calendar.") }
        // The same store as the conflict reads and direct saves.
        let store = DIPEventKitStore.shared
        let event = EKEvent(eventStore: store)
        event.title = fields.title
        event.isAllDay = fields.isAllDay
        if fields.isAllDay {
            // All-day events float: keep the same calendar days as shown (in the source time zone) on every device.
            let days = fields.floatingAllDayDates()
            event.startDate = days.start
            event.endDate = days.end
            event.timeZone = nil
        } else {
            event.startDate = fields.startDate
            event.endDate = fields.endDate
            event.timeZone = fields.timeZone
        }
        if !fields.location.isEmpty { event.location = fields.location }
        if !fields.notes.isEmpty { event.notes = fields.notes }
        event.url = fields.url
        let editor = EKEventEditViewController()
        editor.eventStore = store
        editor.event = event
        // The session is weakly referenced by the editor; this frame keeps it alive until the editor finishes.
        let session = EditorSession()
        return await session.present(editor, from: presenter)
    }

    /// A view controller that can present right now: not an alert, not mid-transition, in a window. Waits briefly
    /// (an alert button was just tapped, or a sheet is still dismissing) instead of presenting from a dying controller.
    @MainActor private static func stablePresenter() async -> UIViewController? {
        for attempt in 0..<12 {
            if let top = topViewController(), isStable(top) { return top }
            guard attempt < 11 else { break }
            try? await Task.sleep(for: .milliseconds(150))
        }
        return nil
    }

    @MainActor private static func isStable(_ controller: UIViewController) -> Bool {
        !(controller is UIAlertController)
            && !controller.isBeingPresented && !controller.isBeingDismissed
            && controller.transitionCoordinator == nil
            && controller.viewIfLoaded?.window != nil
    }

    @MainActor private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    /// One editor presentation. `finish` resumes the continuation the first time only.
    @MainActor private final class EditorSession: NSObject, @preconcurrency EKEventEditViewDelegate, UIAdaptivePresentationControllerDelegate {
        private var continuation: CheckedContinuation<DIPCalendarAddResult, Never>?

        func present(_ editor: EKEventEditViewController, from presenter: UIViewController) async -> DIPCalendarAddResult {
            await withCheckedContinuation { continuation in
                self.continuation = continuation
                editor.editViewDelegate = self
                // Swiping the sheet down skips the editor's own delegate; without this the add would never finish.
                editor.presentationController?.delegate = self
                presenter.present(editor, animated: true)
                // UIKit drops a present() it cannot honor without telling anyone: notice and fail instead of hanging.
                if presenter.presentedViewController !== editor { finish(.failed("Couldn’t open the calendar.")) }
            }
        }

        private func finish(_ result: DIPCalendarAddResult) {
            guard let continuation else { return }
            self.continuation = nil
            continuation.resume(returning: result)
        }

        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            controller.dismiss(animated: true)
            finish(action == .saved ? .added : .cancelled)
        }

        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
            finish(.cancelled)
        }
    }
}
