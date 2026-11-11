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
struct DIPEventKitCalendarAdder: DIPEventCalendarAdding {
    @MainActor func add(_ fields: DIPCalendarEventFields) async -> DIPCalendarAddResult {
        guard let presenter = Self.topViewController() else { return .failed("Couldn’t open the calendar.") }
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = fields.title
        event.isAllDay = fields.isAllDay
        if fields.isAllDay {
            // All-day events float: keep the same calendar days as shown (in the source time zone) on every device.
            var source = Calendar(identifier: .gregorian); source.timeZone = fields.timeZone
            func local(_ date: Date) -> Date {
                let parts = source.dateComponents([.year, .month, .day], from: date)
                return Calendar.current.date(from: parts) ?? date
            }
            event.startDate = local(fields.startDate)
            event.endDate = local(fields.endDate)
            event.timeZone = nil
        } else {
            event.startDate = fields.startDate
            event.endDate = fields.endDate
            event.timeZone = fields.timeZone
        }
        if !fields.location.isEmpty { event.location = fields.location }
        if !fields.notes.isEmpty { event.notes = fields.notes }
        event.url = fields.url
        return await withCheckedContinuation { continuation in
            let editor = EKEventEditViewController()
            editor.eventStore = store
            editor.event = event
            let delegate = EditorDelegate { continuation.resume(returning: $0) }
            editor.editViewDelegate = delegate
            // The delegate is weak on the controller; keep it alive for the editor's lifetime.
            objc_setAssociatedObject(editor, Unmanaged.passUnretained(delegate).toOpaque(), delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            presenter.present(editor, animated: true)
        }
    }

    @MainActor private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    private final class EditorDelegate: NSObject, EKEventEditViewDelegate {
        let finish: (DIPCalendarAddResult) -> Void
        init(finish: @escaping (DIPCalendarAddResult) -> Void) { self.finish = finish }
        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            controller.dismiss(animated: true)
            finish(action == .saved ? .added : .cancelled)
        }
    }
}
