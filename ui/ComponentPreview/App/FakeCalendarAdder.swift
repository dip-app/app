import DIPCore
import SwiftUI

/// Preview/UI-test fake: records the last fields and shows them in an element the UI test can read.
@MainActor final class FakeCalendarAdder: DIPEventCalendarAdding, ObservableObject {
    @Published var summary = "none"
    nonisolated init() {}
    func add(_ fields: DIPCalendarEventFields) async -> DIPCalendarAddResult {
        summary = "\(fields.title)|\(fields.location)|\(Int(fields.endDate.timeIntervalSince(fields.startDate)))|\(fields.isAllDay)"
        return .added
    }
}
