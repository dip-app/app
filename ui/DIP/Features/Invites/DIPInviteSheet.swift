import DIPCore
import DIPDesignSystem
import DIPPresentation
import SwiftUI

/// "Invite a coworker": a name search over the server's minimal coworker directory (name and team only),
/// an optional short note, and one solid Invite pill per person. Solid = pressable; "Invited"/"Going" are
/// outlined because they are informational. The sheet never lists a whole company: the search needs two letters.
struct DIPInviteSheet: View {
    @Bindable var model: DIPInvitePickerModel
    let eventTitle: String
    let onClose: () -> Void
    @FocusState private var searchFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(spacing: 0) {
            header
            searchField.padding(.horizontal, 20)
            noteField.padding(.horizontal, 20).padding(.top, 10)
            ScrollView {
                content.padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 30)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
        .background(.white)
        .preferredColorScheme(.light)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task(id: model.query) { await model.queryChanged() }
    }

    private var header: some View {
        InviteSheetHeader(title: String(localized: "invite.title", defaultValue: "Invite Coworker", comment: "Invite sheet title"), subtitle: eventTitle, closeIdentifier: "invite.close", onClose: onClose)
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField("Search coworkers by name", text: $model.query)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                .textInputAutocapitalization(.words).autocorrectionDisabled()
                .submitLabel(.search).focused($searchFocused)
                .accessibilityLabel("Search coworkers by name")
                .accessibilityIdentifier("invite.search")
            if !model.query.isEmpty {
                Button { model.query = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary).frame(width: 44, height: 44)
                }
                .accessibilityLabel("Clear search").accessibilityIdentifier("invite.search.clear")
            }
        }
        .padding(.leading, 16).padding(.trailing, model.query.isEmpty ? 16 : 0)
        .frame(minHeight: 50)
        .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: Capsule())
    }

    private var noteField: some View {
        VStack(alignment: .leading, spacing: 6) {
        TextField("Add a note (optional)", text: $model.note, axis: .vertical)
            .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
            .lineLimit(1...3)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .frame(minHeight: 44)
            .background(DIPTokens.Color.surfaceMuted.swiftUIColor.opacity(0.6), in: RoundedRectangle(cornerRadius: 20))
            .onChange(of: model.note) { _, text in
                if text.count > DIPInviteRules.messageLimit { model.note = String(text.prefix(DIPInviteRules.messageLimit)) }
            }
            .accessibilityLabel("Note to include with the invitation")
            .accessibilityIdentifier("invite.note")
            Text("Sent with your next invite")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                .foregroundStyle(.secondary).padding(.horizontal, 16)
        }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .idle:
            if model.queryTooShort {
                DIPEmptyState(screen: "invite-hint", title: String(localized: "invite.hint.title", defaultValue: "Keep typing", comment: "Invite sheet: empty state title while the search is too short"), message: String(localized: "invite.hint.message", defaultValue: "Type at least 2 letters of a name.", comment: "Invite sheet: empty state message while the search is too short"), faces: 2)
            } else {
                DIPEmptyState(screen: "invite-start", title: String(localized: "invite.start.title", defaultValue: "Find a coworker", comment: "Invite sheet: initial empty state title"),
                              message: String(localized: "invite.start.message", defaultValue: "Search by name to invite someone from your company. They can accept in one tap.", comment: "Invite sheet: initial empty state message"), faces: 3)
            }
        case .searching where model.coworkers.isEmpty:
            VStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { _ in
                    HStack(spacing: 16) {
                        DIPSkeleton(cornerRadius: -1).frame(width: 50, height: 50)
                        VStack(alignment: .leading, spacing: 8) {
                            DIPSkeleton(cornerRadius: 6).frame(width: 150, height: 16)
                            DIPSkeleton(cornerRadius: 6).frame(width: 100, height: 14)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(height: 75)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Searching coworkers")
            .accessibilityIdentifier("invite.loading")
        case .searching, .results:
            VStack(spacing: 0) {
                ForEach(Array(model.coworkers.enumerated()), id: \.element.id) { index, coworker in
                    row(coworker)
                        .staggeredEntrance(index: index)
                    if coworker.id != model.coworkers.last?.id { Divider() }
                }
            }
            .opacity(model.phase == .searching ? 0.6 : 1)
            .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: model.phase == .searching)
        case .empty:
            DIPEmptyState(screen: "invite-none", title: String(localized: "invite.none.title", defaultValue: "No coworkers found", comment: "Invite sheet: no search results title"),
                          message: String(localized: "invite.none.message", defaultValue: "Check the spelling or try part of their first or last name.", comment: "Invite sheet: no search results message"), faces: 2)
        case .failed(let failure):
            DIPEmptyState(screen: "invite-error", title: String(localized: "invite.error.title", defaultValue: "Couldn’t search", comment: "Invite sheet: search error title"), message: failure.message, faces: 3,
                          actionTitle: String(localized: "invite.error.retry", defaultValue: "Try again", comment: "Invite sheet: retry button after a search error"), action: failure.isRetryable ? { DIPHaptics.commit(); Task { await model.search() } } : nil)
        }
    }

    private func row(_ coworker: DIPCoworker) -> some View {
        let state = model.state(of: coworker)
        // Name and Invite control sit side by side normally; at accessibility sizes the control drops below the name.
        let rowLayout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12)) : AnyLayout(HStackLayout(spacing: 12))
        return VStack(alignment: .leading, spacing: 4) {
            rowLayout {
                HStack(spacing: 16) {
                    DIPMedia(coworker.avatar).resizable().frame(width: 50, height: 50).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(coworker.name).font(DIPReferenceAssets.font("Figtree-Bold", size: 18, relativeTo: .body)).dipLineLimit(1)
                        if !coworker.team.isEmpty {
                            Text(coworker.team).font(DIPReferenceAssets.font("Figtree-Regular", size: 16, relativeTo: .callout))
                                .foregroundStyle(.secondary).dipLineLimit(1)
                        }
                    }
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityElement(children: .combine)
                trailing(coworker, state: state)
            }
            if model.alreadyInvitedIDs.contains(coworker.id) {
                InviteNotice(text: String(localized: "invite.row.alreadyInvited", defaultValue: "A coworker already invited \(coworker.name).", comment: "Invite sheet: notice under a person someone else already invited; %@ = person name"), identifier: "invite.row.already.\(coworker.id)").padding(.leading, 66)
            } else if let failure = model.rowErrors[coworker.id] {
                InviteNotice(text: failure.isRetryable ? String(localized: "invite.row.retry", defaultValue: "\(failure.message) Tap Invite to try again.", comment: "Invite sheet: error under a person where retrying may work; %@ = reason sentence") : failure.message,
                             identifier: "invite.row.error.\(coworker.id)").padding(.leading, 66)
            }
        }
        .padding(.vertical, 8).frame(minHeight: 75)
        .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: model.rowErrors[coworker.id])
        .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: model.alreadyInvitedIDs)
        // The notice appears silently otherwise: say it.
        .onChange(of: model.rowErrors[coworker.id]) { _, new in
            if let new { AccessibilityNotification.Announcement(new.message).post() }
        }
        .onChange(of: model.alreadyInvitedIDs.contains(coworker.id)) { _, already in
            if already { AccessibilityNotification.Announcement(String(localized: "invite.row.alreadyInvited", defaultValue: "A coworker already invited \(coworker.name).", comment: "Invite sheet: notice under a person someone else already invited; %@ = person name")).post() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("invite.row.\(coworker.id)")
    }

    /// The trailing control swaps in place (Invite -> Invited / Going) with a scale-and-fade; the row never changes size.
    private func trailing(_ coworker: DIPCoworker, state: DIPCoworker.State) -> some View {
        ZStack(alignment: .trailing) {
            control(coworker, state: state)
                .id(state)
                .transition(InviteMotion.swap(reduceMotion: reduceMotion))
        }
        .frame(minWidth: 96, minHeight: 44, alignment: .trailing)
        .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: state)
    }

    @ViewBuilder private func control(_ coworker: DIPCoworker, state: DIPCoworker.State) -> some View {
        switch state {
        case .available:
            let sending = model.sending.contains(coworker.id)
            Button {
                // A second tap while the first is sending is ignored: no haptic, no failure.
                guard !model.sending.contains(coworker.id) else { return }
                DIPHaptics.commit()
                Task {
                    let sent = await model.send(coworker)
                    if sent {
                        DIPHaptics.success()
                        AccessibilityNotification.Announcement(String(localized: "invite.announce.sent", defaultValue: "Invitation sent to \(coworker.name)", comment: "VoiceOver announcement after sending an invitation; %@ = person name")).post()
                    } else if model.rowErrors[coworker.id] != nil { DIPHaptics.failure() }
                }
            } label: {
                Group {
                    if sending { ProgressView().tint(.white) }
                    else { Text("Invite").font(DIPReferenceAssets.font("Inter-Regular", size: 14)).foregroundStyle(.white) }
                }
                .dipFixedFrame(width: 84, height: 44)
                .background(DIPTokens.Color.eventsAccent.swiftUIColor, in: Capsule())
                .contentShape(Capsule())
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .disabled(sending)
            .accessibilityLabel("Invite \(coworker.name)")
            .accessibilityValue(sending ? String(localized: "invite.sending", defaultValue: "Sending", comment: "VoiceOver value of the Invite button while sending") : "")
            .accessibilityIdentifier("invite.send.\(coworker.id)")
        case .invited:
            statusPill(String(localized: "invite.chip.invited", defaultValue: "Invited", comment: "Invite sheet: outlined chip for a person already invited"), symbol: "checkmark", id: "invite.state.\(coworker.id)")
        case .going:
            statusPill(String(localized: "invite.chip.going", defaultValue: "Going", comment: "Invite sheet: outlined chip for a person already going to this activity"), symbol: "person.fill.checkmark", id: "invite.state.\(coworker.id)")
        }
    }

    /// Outlined = informational: not a Button.
    private func statusPill(_ title: String, symbol: String, id: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 12, weight: .bold)).accessibilityHidden(true)
            Text(title).font(DIPReferenceAssets.font("Inter-Regular", size: 14))
        }
        .foregroundStyle(DIPTokens.Color.eventsAccent.swiftUIColor)
        .frame(minWidth: 84, minHeight: 44).padding(.horizontal, 6)
        .overlay(Capsule().strokeBorder(DIPTokens.Color.eventsAccent.swiftUIColor, lineWidth: 2))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityIdentifier(id)
    }
}
