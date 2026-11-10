import DIPCore
import Foundation

/// Selection rules shared by every interest picker host: the Profile sheet, the Edit profile
/// draft picker and the embedded onboarding picker. UI-free so hosts and tests use one copy.
enum InterestSelectionRules {
    /// Mirrors `EditableProfile.maximumListCount` and firestore.rules.
    static let maximumSelection = 10

    /// Catalog entries with duplicate ids removed (first entry wins).
    static func unique(_ options: [DIPInterest]) -> [DIPInterest] {
        var seen = Set<String>()
        return options.filter { seen.insert($0.id).inserted }
    }

    /// Options whose name contains the trimmed query; every option when the query is blank.
    static func filtered(_ options: [DIPInterest], query: String) -> [DIPInterest] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return options.filter { search.isEmpty || $0.name.localizedStandardContains(search) }
    }

    /// True when `id` can be added: it is already selected, or the maximum is not reached.
    static func canSelect(_ id: String, in selection: Set<String>) -> Bool {
        selection.contains(id) || selection.count < maximumSelection
    }

    /// Removes a selected id, or adds it while under the maximum; otherwise unchanged.
    static func toggling(_ id: String, in selection: Set<String>) -> Set<String> {
        var result = selection
        if result.contains(id) { result.remove(id) }
        else if result.count < maximumSelection { result.insert(id) }
        return result
    }

    /// Selected ids in option (catalog) order, which is the saved order.
    static func ordered(_ selection: Set<String>, options: [DIPInterest]) -> [String] {
        options.map(\.id).filter(selection.contains)
    }
}
