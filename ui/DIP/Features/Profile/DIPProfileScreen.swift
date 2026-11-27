import DIPAccounts
import DIPCore
import DIPDesignSystem
import SwiftUI
import UIKit

/// Renders repository-owned profile data. Only form drafts and presentation state are local.
struct DIPProfileScreen: View {
    let profile: DIPProfile
    let showsBottomBar: Bool
    let onSelectTab: (DIPHomeTab) -> Void
    /// (eventID, photoID): the album opens on that photo when the memory knows it.
    let onMemory: (String, String?) -> Void
    let onSave: (ProfileEdit) async throws -> Void
    let onSignOut: (() async -> Void)?
    let interestCatalogLoading: Bool
    let interestCatalogError: String?
    let onRetryInterestCatalog: (() -> Void)?
    /// "How DIP works": replays the onboarding tour. Nil hides the row.
    let onReplayTour: (() -> Void)?
    /// "Notifications": opens the notification settings. Nil (push off, no preferences adapter) hides the row.
    let onOpenNotificationSettings: (() -> Void)?
    @State private var isSigningOut = false
    @Environment(\.presentBugReport) private var presentBugReport
    @Environment(\.dipCalendar) private var calendar
    @AppStorage(ShakeGate.enabledKey) private var shakeToReport = true
    @AppStorage(ShakeGate.promptKey) private var askBeforeReporting = true

    @State private var isEditing = false
    @State private var isChoosingInterests = false
    @State private var isChoosingDraftInterests = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.dipDuoOpen) private var duoOpen
    @Environment(\.dipTopInset) private var topInset
    /// Duo display whose tabs are in the sensor-column rail: no floating bar to keep clear of.
    @Environment(\.dipDuoTabsInRail) private var tabsInRail
    @State private var draftDepartment = ""
    @State private var draftCity = ""
    @State private var draftInterests: Set<String> = []
    @State private var draftJobTitle = ""
    @State private var draftAvailability: [String] = []
    @State private var draftRadius = 20
    @State private var isSaving = false
    @State private var saveError: String?
    /// The drafts as they were when Edit opened; a difference means unsaved changes.
    @State private var draftBaseline = DraftSnapshot()
    @State private var confirmsDiscard = false

    init(
        profile: DIPProfile,
        showsBottomBar: Bool = true,
        onSelectTab: @escaping (DIPHomeTab) -> Void,
        onMemory: @escaping (String, String?) -> Void,
        onSave: @escaping (ProfileEdit) async throws -> Void,
        onSignOut: (() async -> Void)? = nil,
        interestCatalogLoading: Bool = false, interestCatalogError: String? = nil,
        onRetryInterestCatalog: (() -> Void)? = nil,
        onReplayTour: (() -> Void)? = nil,
        onOpenNotificationSettings: (() -> Void)? = nil
    ) {
        self.onOpenNotificationSettings = onOpenNotificationSettings
        self.onReplayTour = onReplayTour
        self.interestCatalogLoading = interestCatalogLoading
        self.interestCatalogError = interestCatalogError
        self.onRetryInterestCatalog = onRetryInterestCatalog
        self.onSignOut = onSignOut
        self.profile = profile
        self.showsBottomBar = showsBottomBar
        self.onSelectTab = onSelectTab
        self.onMemory = onMemory
        self.onSave = onSave
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Color.white
                ScrollView {
                    profileLayout
                    .padding(.horizontal, 20)
                    .padding(.top, topInset)
                    .padding(.bottom, DIPDuoPaneLayout.bottomClearance(open: duoOpen || tabsInRail, phone: 150))
                }
                .scrollIndicators(.hidden)
                .padding(.bottom, 22)
                // The fade hides content scrolling under the phone status bar; Duo displays (status in the side
                // column) have none.
                if !duoOpen && !tabsInRail {
                    LinearGradient(
                        stops: [
                            .init(color: .white, location: 0.35),
                            .init(color: .white.opacity(0.88), location: 0.54221),
                            .init(color: .white.opacity(0), location: 1),
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                    .frame(height: 60)
                    .allowsHitTesting(false)
                }
                if showsBottomBar {
                    DIPFloatingNavigation(selected: .profile, onSelect: onSelectTab)
                        .padding(.horizontal, 20)
                        .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
                }
            }
            .clipped()
            .coordinateSpace(name: ProfileBadgeLink.pageSpace)
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
        .sheet(isPresented: $isEditing) { editForm.environment(\.dynamicTypeSize, dynamicTypeSize).dipDuoSheetSizing(duoOpen) }
        .sheet(isPresented: $isChoosingInterests) {
            DIPInterestPicker(options: interestOptions, selection: Set(profile.interestTagIDs)) { interests in
                try await onSave(.init(department: profile.department, city: profile.city, interestTagIDs: interests))
            }
            .environment(\.dynamicTypeSize, dynamicTypeSize)
            .dipDuoSheetSizing(duoOpen)
        }
    }

    /// Phone: one column (header card, status, memories, actions). Open Duo: the header card, status and actions on
    /// the left, the favorite memories on the right.
    @ViewBuilder private var profileLayout: some View {
        if duoOpen {
            HStack(alignment: .top, spacing: 28) {
                VStack(alignment: .leading, spacing: 28) {
                    ProfileHeaderCard(
                        profile: profile, catalogReady: catalogReady,
                        onEdit: beginEditing, onAddInterests: { isChoosingInterests = true })
                    catalogStatus
                    // Memories sit under the card so the two columns end at similar heights (the card alone left a
                    // large empty area under it while every row stacked on the right).
                    memories
                }
                .frame(width: 360, alignment: .topLeading)
                VStack(alignment: .leading, spacing: 28) {
                    profileActions
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        } else {
            VStack(alignment: .leading, spacing: 28) {
                ProfileHeaderCard(
                    profile: profile, catalogReady: catalogReady,
                    onEdit: beginEditing, onAddInterests: { isChoosingInterests = true })
                catalogStatus
                memories
                profileActions
            }
        }
    }

    @ViewBuilder private var profileActions: some View {
        if let onOpenNotificationSettings {
            actionRow(String(localized: "profile.notifications.row", defaultValue: "Notifications", comment: "Profile: row that opens notification settings"), symbol: "bell", identifier: "profile.notifications", action: onOpenNotificationSettings)
        }
        if let onReplayTour {
            actionRow(String(localized: "profile.howDIPWorks.row", defaultValue: "How DIP works", comment: "Profile: row that replays the onboarding tour"), symbol: "sparkles", identifier: "profile.howDIPWorks", action: onReplayTour)
        }
        if calendar.featureEnabled, calendar.device != nil {
            calendarSection
        }
        if let presentBugReport {
            reportProblem(presentBugReport)
        }
        if let onSignOut {
            // VIS-3: a session-ending action reads as destructive text, apart from the neutral "Report a problem" pill.
            DIPTextActionRow(
                title: isSigningOut ? String(localized: "profile.signOut.working", defaultValue: "Signing out…", comment: "Profile: sign out button while signing out") : String(localized: "profile.signOut", defaultValue: "Sign out", comment: "Profile: sign out button"),
                systemImage: "rectangle.portrait.and.arrow.right", role: .destructive, centered: true) {
                guard !isSigningOut else { return }
                DIPHaptics.commit()
                isSigningOut = true
                Task { await onSignOut(); isSigningOut = false }
            }
            .disabled(isSigningOut)
            .accessibilityIdentifier("profile.signout")
        }
    }

    /// The switch reads "on" only when the member opted in AND iOS gave full access.
    private var conflictsActive: Bool { calendar.preferences.showsConflicts && calendar.access == .fullAccess }

    /// Why conflicts cannot work right now, in the words of the iOS state; nil when there is nothing to fix in Settings.
    private var calendarAccessCopy: String? {
        switch calendar.access {
        case .denied: String(localized: "profile.calendar.accessOff", defaultValue: "Calendar access is off for DIP in iOS Settings.", comment: "Profile calendar section: calendar permission denied in iOS")
        case .restricted: String(localized: "profile.calendar.restricted", defaultValue: "Calendar access is restricted on this iPhone (for example by Screen Time or a device profile), so DIP can’t check for conflicts.", comment: "Profile calendar section: calendar permission restricted by the device")
        case .writeOnly: String(localized: "profile.calendar.writeOnly", defaultValue: "DIP can add events to your calendar, but checking for conflicts needs full access. Allow full access in iOS Settings.", comment: "Profile calendar section: only write access to the calendar was granted")
        case .notDetermined, .fullAccess: calendar.accessDeniedNotice ? String(localized: "profile.calendar.accessOff", defaultValue: "Calendar access is off for DIP in iOS Settings.", comment: "Profile calendar section: calendar permission denied in iOS") : nil
        }
    }

    /// Opt-in calendar conflicts (stretch S1). The calendar is read on this iPhone only.
    private var calendarSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("CALENDAR")
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 24, relativeTo: .title2))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                .accessibilityAddTraits(.isHeader)
            Toggle(isOn: Binding(
                // On only while DIP can really read the calendar: a stored opt-in without full access must not look active.
                get: { conflictsActive },
                set: { new in Task { await calendar.setShowsConflicts(new) } })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Show calendar conflicts")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .body))
                    Text("DIP checks your calendar on this iPhone and warns you when an activity overlaps. Your calendar never leaves your phone.")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.72))
                }
            }
            .tint(DIPTokens.Color.actionPrimary.swiftUIColor)
            .padding(16)
            .frame(minHeight: 44)
            .background(DIPTokens.Color.surfaceMuted.swiftUIColor,
                        in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
            .accessibilityIdentifier("profile.calendarConflicts")
            if conflictsActive {
                Toggle(isOn: Binding(
                    get: { calendar.preferences.treatsAllDayAsBusy },
                    set: { calendar.setTreatsAllDayAsBusy($0) })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Count all-day events as busy")
                            .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .body))
                        Text("Holidays and out-of-office days count as conflicts.")
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                            .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.72))
                    }
                }
                .tint(DIPTokens.Color.actionPrimary.swiftUIColor)
                .padding(16)
                .frame(minHeight: 44)
                .background(DIPTokens.Color.surfaceMuted.swiftUIColor,
                            in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
                .accessibilityIdentifier("profile.calendarAllDay")
            }
            if let copy = calendarAccessCopy {
                Text(copy)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .footnote))
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.72))
                    .accessibilityIdentifier("profile.calendarAccessCopy")
                DIPButton(String(localized: "profile.calendar.openSettings", defaultValue: "Open Settings", comment: "Profile calendar section: button that opens iOS Settings"), emphasis: .secondary) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
                .accessibilityIdentifier("profile.calendarSettings")
            }
        }
    }

    /// A pill row that opens something (How DIP works, Notifications).
    private func actionRow(_ title: String, symbol: String, identifier: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol).accessibilityHidden(true)
                Text(title)
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .body))
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(.black)
            .padding(.horizontal, 18)
            .frame(minHeight: 56)
            .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .accessibilityIdentifier(identifier)
    }

    /// "Report a problem" is the accessible, non-shake path to the same sheet; the toggle turns the shake off.
    private func reportProblem(_ present: @escaping @MainActor (BugReportSource) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("HELP US FIX THINGS")
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 24, relativeTo: .title2))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                .accessibilityAddTraits(.isHeader)
            Toggle(isOn: $shakeToReport) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Shake to report a problem")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .body))
                    Text("Shake your phone anywhere in DIP to tell us what went wrong.")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.72))
                }
            }
            .tint(DIPTokens.Color.actionPrimary.swiftUIColor)
            .padding(16)
            .background(DIPTokens.Color.surfaceMuted.swiftUIColor,
                        in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
            .accessibilityIdentifier("profile.shakeToReport")
            if shakeToReport {
                Toggle(isOn: $askBeforeReporting) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Ask before opening the report")
                            .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .body))
                        Text("After a shake, DIP asks “Report a problem?” first. Turn off to open the report straight away.")
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                            .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.72))
                    }
                }
                .tint(DIPTokens.Color.actionPrimary.swiftUIColor)
                .padding(16)
                .background(DIPTokens.Color.surfaceMuted.swiftUIColor,
                            in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
                .accessibilityIdentifier("profile.shakeAskFirst")
            }
            DIPButton(String(localized: "profile.report.button", defaultValue: "Report a problem", comment: "Profile: button that opens the report a problem sheet"), emphasis: .secondary) { present(.profile) }
                .accessibilityIdentifier("profile.reportProblem")
        }
    }

    @ViewBuilder private var catalogStatus: some View {
        if interestCatalogLoading {
            ProgressView("Loading interests…").accessibilityIdentifier("profile.interests.loading")
        }
        if let interestCatalogError {
            VStack(alignment: .leading, spacing: 8) {
                Text(interestCatalogError)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                Button { onRetryInterestCatalog?() } label: {
                    Text("Retry interests").dipHitSlop(horizontal: 8, vertical: 14)
                }
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                    .accessibilityIdentifier("profile.interests.catalog.retry")
            }
        }
    }

    private var catalogReady: Bool { !interestCatalogLoading && interestCatalogError == nil }

    private var memories: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("FAVORITE MEMORIES")
                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 24, relativeTo: .title2))
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                    .accessibilityAddTraits(.isHeader)
                    // Hidden demo language switch (long press 2 s; docs/design/ios-i18n.md). Adds no pixels.
                    .demoLanguageTrigger()
                Spacer(minLength: 8)
            }
            if profile.favoriteMemories.isEmpty {
                DIPEmptyState(
                    screen: "profile-memories", title: String(localized: "profile.memories.empty.title", defaultValue: "No favorite memories yet", comment: "Profile: empty state title for favorite memories"),
                    message: String(localized: "profile.memories.empty.message", defaultValue: "Favorite a photo from a past event and it will show up here.", comment: "Profile: empty state message for favorite memories"))
            } else {
                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                    spacing: 12
                ) {
                    ForEach(Array(profile.favoriteMemories.enumerated()), id: \.element.id) { index, memory in
                        memoryTile(memory, index: index)
                    }
                }
            }
        }
    }

    private func memoryTile(_ memory: DIPFavoriteMemory, index: Int) -> some View {
        Button { onMemory(memory.eventID, memory.photoID) } label: {
            Color.clear.aspectRatio(1, contentMode: .fit)
                .overlay { DIPMedia(memory.image).resizable().scaledToFill() }
                .clipShape(RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
                .overlay(alignment: .bottomLeading) {
                    Text(memory.dateLabel)
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 13))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(.white, in: Capsule())
                        .padding(10)
                }
                .contentShape(RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .accessibilityLabel("Favorite memory, \(memory.dateLabel)")
        .accessibilityIdentifier("profile.memory.\(index)")
        .id(memory.id)
    }

    /// Header pills. Stored interest ids are named from the catalog, so until it has loaded
    /// (or after it failed) no pills are shown, rather than labelling every saved interest
    /// "Unavailable interest" as if it had been removed. The stored ids are untouched.
    nonisolated static func headerInterests(_ profile: DIPProfile, catalogReady: Bool) -> [DIPInterest] {
        catalogReady ? profile.selectedInterests : []
    }

    /// Labels for known availability ids, in option order. Unknown stored ids are kept on
    /// save but not shown, since there is no label for them.
    nonisolated static func availabilityLabels(_ ids: [String]) -> [String] {
        AvailabilityOption.all.filter { ids.contains($0.id) }.map(\.label)
    }

    /// Saved order: known options in option order, then unknown stored ids unchanged.
    nonisolated static func orderedAvailability(_ ids: [String]) -> [String] {
        let known = AvailabilityOption.all.map(\.id)
        return known.filter { ids.contains($0) } + ids.filter { !known.contains($0) }
    }

    nonisolated static let standardRadii = [5, 10, 20, 50, 100]

    /// Standard choices plus the stored value, so an unusual saved radius is never lost.
    nonisolated static func radiusChoices(including current: Int) -> [Int] {
        Array(Set(standardRadii + [current])).sorted()
    }

    /// Icon-row wording on the profile: "Events within 20 miles".
    nonisolated static func radiusPhrase(_ miles: Int) -> String {
        String(localized: "profile.radius.phrase", defaultValue: "Events within \(miles) miles", comment: "Profile details row: travel radius; %lld = miles")
    }

    nonisolated static func radiusLabel(_ miles: Int) -> String {
        String(localized: "profile.radius.label", defaultValue: "Within \(miles) miles", comment: "Profile edit form: travel radius choice; %lld = miles")
    }

    private var interestOptions: [DIPInterest] {
        let known = Set(profile.interestCatalog.map(\.id))
        let missing = profile.interestTagIDs.filter { !known.contains($0) }.map {
            DIPInterest(id: $0, name: String(localized: "profile.interest.unavailable", defaultValue: "Unavailable interest", comment: "Profile: name shown for a saved interest that no longer exists in the catalog"), sortOrder: Int.max)
        }
        return profile.interestCatalog.sorted {
            $0.sortOrder == $1.sortOrder ? $0.id < $1.id : $0.sortOrder < $1.sortOrder
        } + missing
    }

    private func beginEditing() {
        draftDepartment = profile.department
        draftCity = profile.city
        draftInterests = Set(profile.interestTagIDs)
        draftJobTitle = profile.jobTitle
        draftAvailability = profile.availability
        draftRadius = profile.travelRadiusMiles ?? 20
        saveError = nil
        draftBaseline = draftSnapshot
        isEditing = true
    }

    /// Everything the form edits, comparable; availability as a set (its order is not the member's choice).
    private struct DraftSnapshot: Equatable {
        var department = "", city = "", jobTitle = ""
        var interests: Set<String> = []
        var availability: Set<String> = []
        var radius = 20
    }

    private var draftSnapshot: DraftSnapshot {
        DraftSnapshot(department: draftDepartment, city: draftCity, jobTitle: draftJobTitle, interests: draftInterests,
                      availability: Set(draftAvailability), radius: draftRadius)
    }

    private var hasUnsavedChanges: Bool { draftSnapshot != draftBaseline }

    private func labeledField(_ title: String, text: Binding<String>, id: String) -> some View {
        LabeledContent(title) {
            TextField(title, text: text)
                .multilineTextAlignment(.trailing)
                .accessibilityIdentifier(id)
        }
    }

    private var editForm: some View {
        NavigationStack {
            Form {
                Section("Profile") {
                    LabeledContent("Name") {
                        Text(profile.displayName).accessibilityIdentifier("profile.edit.name")
                    }
                    // Visible labels: a filled field otherwise loses its placeholder, and
                    // "Cool cat" vs "SWE" can't be told apart.
                    if profile.hasAccountDetails {
                        labeledField(String(localized: "profile.edit.jobTitle", defaultValue: "Job title", comment: "Profile edit form: field label"), text: $draftJobTitle, id: "profile.edit.jobTitle")
                            .textContentType(.jobTitle)
                    }
                    labeledField(String(localized: "profile.edit.department", defaultValue: "Department", comment: "Profile edit form: field label"), text: $draftDepartment, id: "profile.edit.department")
                    labeledField(String(localized: "profile.edit.city", defaultValue: "City", comment: "Profile edit form: field label"), text: $draftCity, id: "profile.edit.city")
                        .textContentType(.addressCity)
                }
                Section("Interests") {
                    DraftInterestsRow(selection: $draftInterests) { isChoosingDraftInterests = true }
                        .accessibilityIdentifier("profile.edit.interests")
                        .disabled(interestCatalogLoading || interestCatalogError != nil)
                }
                if profile.hasAccountDetails {
                    Section("When you're free") {
                        ForEach(AvailabilityOption.all) { option in
                            Toggle(option.label, isOn: Binding(
                                get: { draftAvailability.contains(option.id) },
                                set: { isOn in
                                    if isOn, !draftAvailability.contains(option.id),
                                       draftAvailability.count < EditableProfile.maximumListCount {
                                        draftAvailability.append(option.id)
                                    } else if !isOn {
                                        draftAvailability.removeAll { $0 == option.id }
                                    }
                                }))
                            .accessibilityIdentifier("profile.edit.availability.\(option.id)")
                        }
                    }
                    Section("How far you'll travel") {
                        Picker("Travel radius", selection: $draftRadius) {
                            ForEach(Self.radiusChoices(including: draftRadius), id: \.self) { miles in
                                Text(Self.radiusLabel(miles)).tag(miles)
                            }
                        }
                        .accessibilityIdentifier("profile.edit.radius")
                    }
                }
                if let saveError {
                    Section {
                        Text(saveError)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("profile.edit.error")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.08))
            .tint(DIPTokens.Color.actionPrimary.swiftUIColor)
            .disabled(isSaving)
            .navigationTitle("Edit profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if hasUnsavedChanges { confirmsDiscard = true } else { isEditing = false }
                    }
                    .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? String(localized: "profile.edit.saving", defaultValue: "Saving…", comment: "Profile edit form: save button while saving") : String(localized: "profile.edit.save", defaultValue: "Save", comment: "Profile edit form: save button")) {
                        Task { await saveProfile() }
                    }
                    .disabled(isSaving)
                    .accessibilityIdentifier("profile.edit.save")
                }
            }
            // A swipe-down must not throw away typing: with unsaved changes only Cancel (which asks) closes the sheet.
            .interactiveDismissDisabled(isSaving || hasUnsavedChanges)
            .confirmationDialog("Discard your changes?", isPresented: $confirmsDiscard, titleVisibility: .visible) {
                Button("Discard changes", role: .destructive) { isEditing = false }
                Button("Keep editing", role: .cancel) {}
            }
        }
        .sheet(isPresented: $isChoosingDraftInterests) {
            DIPInterestPicker(options: interestOptions, selection: draftInterests) { interests in
                draftInterests = Set(interests)
            }
            .environment(\.dynamicTypeSize, dynamicTypeSize)
            .dipDuoSheetSizing(duoOpen)
        }
    }

    @MainActor
    private func saveProfile() async {
        guard !isSaving else { return }
        let edit = ProfileEdit(
            department: draftDepartment.trimmingCharacters(in: .whitespacesAndNewlines),
            city: draftCity.trimmingCharacters(in: .whitespacesAndNewlines),
            interestTagIDs: interestOptions.map(\.id).filter { draftInterests.contains($0) },
            // Fixture profiles have no account details; nil leaves them untouched.
            jobTitle: profile.hasAccountDetails ? draftJobTitle.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
            availability: profile.hasAccountDetails ? Self.orderedAvailability(draftAvailability) : nil,
            travelRadiusMiles: profile.hasAccountDetails ? draftRadius : nil)
        isSaving = true
        saveError = nil
        DIPHaptics.commit()
        defer { isSaving = false }
        do {
            try await onSave(edit)
            DIPHaptics.success()
            isEditing = false
        } catch {
            DIPHaptics.failure()
            saveError = String(localized: "profile.edit.error", defaultValue: "Your profile could not be saved. Try again.", comment: "Profile edit form: error after saving failed")
            AccessibilityNotification.Announcement(saveError ?? "").post()
        }
    }
}

/// The sheet's interest count reads the draft through a binding. Read directly from the
/// presenting view's state, the sheet kept showing the value from before Edit was tapped
/// ("0 selected" while the profile had interests); saving was unaffected.
private struct DraftInterestsRow: View {
    @Binding var selection: Set<String>
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            LabeledContent("Choose interests", value: String(localized: "profile.edit.interests.selected", defaultValue: "\(selection.count) selected", comment: "Profile edit form: number of interests chosen; %lld = count"))
        }
    }
}
