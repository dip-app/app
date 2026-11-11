import DIPCore
import SwiftUI

/// Review host for the change-history sheet states: `--changes-sheet=empty|single|long`.
struct ChangesSheetPreview: View {
    let mode: String
    private var log: [DIPChangeLogEntry] {
        let now = Date()
        switch mode {
        case "empty": return []
        case "single":
            return [DIPChangeLogEntry(at: now.addingTimeInterval(-7_200), revision: 2, changes: [
                DIPFieldChange(field: "title", from: "Yoga", to: "Puppy Yoga")])]
        default:
            let long = String(repeating: "Bring a mat and water. ", count: 4)
            return (2...8).map { revision in
                DIPChangeLogEntry(at: now.addingTimeInterval(-Double(revision) * 40_000), revision: revision, changes: [
                    DIPFieldChange(field: "venue.name", from: "Phipps Conservatory and Botanical Gardens", to: "Schenley Park Visitor Center"),
                    DIPFieldChange(field: "venue.address", from: "1 Schenley Dr", to: long),
                    DIPFieldChange(field: "description", from: "a", to: "b")])
            }
        }
    }
    var body: some View {
        DIPEventChangesSheet(eventTitle: "Puppy Yoga", log: log)
    }
}
