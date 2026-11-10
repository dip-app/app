import SwiftUI

/// Connects the model to the embedded `DIPInterestPicker`:
///
/// ```swift
/// DIPInterestPicker(options: model.options, selection: model.selectionBinding,
///                   embedded: model.pickerState)
/// ```
extension OnboardingInterestsModel {
    /// Picker writes go through `setSelection`, which applies the step's rules.
    var selectionBinding: Binding<Set<String>> {
        Binding(get: { self.selection }, set: { self.setSelection($0) })
    }

    var pickerState: DIPInterestPicker.EmbeddedState {
        let catalog: DIPInterestPicker.EmbeddedState.Catalog = switch self.catalog {
        case .loading: .loading
        case .failed: .failed(Self.catalogFailedMessage)
        // An empty catalog normally skips the step; if shown, the picker's empty state explains it.
        case .empty, .ready: .ready
        }
        return .init(isSaving: isSaving, errorMessage: saveErrorMessage, catalog: catalog)
    }
}
