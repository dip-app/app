import DIPCore
import DIPDesignSystem
import DIPPresentation
import SwiftUI

/// Invitations (opened from the bell): Received (accept or decline) and Sent (status). Accepting joins the
/// activity through the same server transaction as Join, so a full or started activity fails with a clear
/// reason and the invitation stays pending. Outlined pills are informational; solid ones are pressable.
struct DIPInvitationsScreen: View {
    enum Tab: Hashable { case received, sent }

    let model: DIPInvitesModel
    /// The member's CURRENT RSVP for an activity (true going, false not going, nil unknown): splits accepted invitations into Going / Cancelled.
    var rsvp: (String) -> Bool? = { _ in nil }
    /// Rejoin an activity through the normal RSVP join path; nil on success, otherwise why it was refused.
    var onRejoin: (String) async -> DIPInviteFailure? = { _ in .unknown }
    let onOpenEvent: (String) -> Void
    let onRetry: () -> Void
    let onClose: () -> Void
    @State private var tab: Tab
    @State private var toast: String?
    /// Bumped once the acceptance grace has passed, so the inbox is re-evaluated against the live RSVP state.
    @State private var graceTick = 0
    @State private var toastTask: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(model: DIPInvitesModel, initialTab: Tab = .received,
         rsvp: @escaping (String) -> Bool? = { _ in nil },
         onRejoin: @escaping (String) async -> DIPInviteFailure? = { _ in .unknown },
         onOpenEvent: @escaping (String) -> Void, onRetry: @escaping () -> Void, onClose: @escaping () -> Void) {
        self.model = model; self.rsvp = rsvp; self.onRejoin = onRejoin
        self.onOpenEvent = onOpenEvent; self.onRetry = onRetry; self.onClose = onClose
        _tab = State(initialValue: initialTab)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            DIPSegmentedToggle(
                segments: [.init(id: Tab.received, title: model.badgeCount > 0 ? "Received (\(model.badgeCount))" : "Received", identifier: "invitations.segment.received"),
                           .init(id: Tab.sent, title: "Sent", identifier: "invitations.segment.sent")],
                selection: tab, accent: DIPTokens.Color.actionPrimary.swiftUIColor, height: 50, fontSize: 18
            ) { newTab in
                DIPHaptics.select()
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { tab = newTab }
            }
            .padding(.horizontal, 20)
            if model.isStale { offlineBanner.padding(.horizontal, 20).padding(.top, 10) }
            ScrollView {
                content.padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .refreshable { onRetry() }
        }
        .background(.white)
        .preferredColorScheme(.light)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .overlay(alignment: .bottom) { toastView }
        .task(id: model.joinedInviteIDs) {
            guard !model.joinedInviteIDs.isEmpty else { return }
            try? await Task.sleep(for: .seconds(DIPInvitesModel.acceptanceGrace + 0.5))
            graceTick += 1
        }
    }

    private var header: some View {
        InviteSheetHeader(title: "Invitations", closeIdentifier: "invitations.close", onClose: onClose)
    }

    /// Informational (outlined): the list below is the last one received.
    private var offlineBanner: some View {
        Label("You’re offline. Showing your last invitations.", systemImage: "wifi.slash")
            .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .footnote))
            .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
            .padding(.horizontal, 16).frame(minHeight: 44).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
            .accessibilityIdentifier("invitations.offline")
    }

    private var content: some View {
        ZStack(alignment: .top) { stateContent.transition(.opacity) }
            .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: model.invites == nil)
            .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: tab)
    }

    @ViewBuilder private var stateContent: some View {
        if model.invites == nil {
            switch model.phase {
            case .failed(let message):
                DIPEmptyState(screen: "invitations-error", title: "Couldn’t load invitations", message: message, faces: 3,
                              actionTitle: "Try again", action: { DIPHaptics.select(); onRetry() })
            default: loading
            }
        } else {
            let inbox = model.inbox(rsvp: rsvp)
            let _ = graceTick
            switch tab {
            case .received: received(inbox)
            case .sent: sent(inbox)
            }
        }
    }

    private var loading: some View {
        VStack(spacing: 12) {
            ForEach(0..<3, id: \.self) { _ in DIPSkeleton(cornerRadius: DIPTokens.Radius.card).frame(height: 150) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading invitations")
        .accessibilityIdentifier("invitations.loading")
    }

    // MARK: Received

    @ViewBuilder private func received(_ inbox: DIPInviteInbox) -> some View {
        if inbox.isEmptyReceived {
            DIPEmptyState(screen: "invitations-received", title: "No invitations yet",
                          message: "When a coworker invites you to an activity, it shows up here.")
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(inbox.pending) { invite in
                    receivedCard(invite).transition(InviteMotion.exit(reduceMotion: reduceMotion))
                }
                if !inbox.accepted.isEmpty {
                    Text("Going").font(DIPReferenceAssets.font("Figtree-Regular", size: 18)).foregroundStyle(.black)
                        .padding(.top, 8).accessibilityAddTraits(.isHeader)
                        .transition(.opacity)
                    ForEach(inbox.accepted) { invite in
                        acceptedRow(invite).transition(InviteMotion.exit(reduceMotion: reduceMotion))
                    }
                }
                if !inbox.cancelled.isEmpty {
                    Text("Cancelled").font(DIPReferenceAssets.font("Figtree-Regular", size: 18)).foregroundStyle(.black)
                        .padding(.top, 8).accessibilityAddTraits(.isHeader)
                        .transition(.opacity)
                    ForEach(inbox.cancelled) { invite in
                        cancelledRow(invite).transition(InviteMotion.exit(reduceMotion: reduceMotion))
                    }
                }
            }
            // Accepting or declining animates the card out (or into Going) and closes the gap below it.
            .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: inbox.pending.map(\.id) + inbox.accepted.map(\.id) + inbox.cancelled.map { "c\($0.id)" })
        }
    }

    private func receivedCard(_ invite: DIPInvite) -> some View {
        let busy = model.answering.contains(invite.id)
        let failure = model.answerErrors[invite.id]
        // A definite refusal (full, started, cancelled, gone) will not succeed on a second tap: Accept stays off.
        let refused = failure.map { !$0.isRetryable } ?? false
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                DIPMedia(invite.avatar).resizable().frame(width: 50, height: 50).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(invite.personName) invited you")
                        .font(DIPReferenceAssets.font("Figtree-Bold", size: 18, relativeTo: .body)).lineLimit(2)
                    Text(DIPInviteInbox.shortWhenText(invite.eventStart))
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 16, relativeTo: .callout)).foregroundStyle(.secondary)
                }
                .foregroundStyle(.black)
                Spacer(minLength: 0)
            }
            Text(invite.eventTitle)
                .font(DIPReferenceAssets.font("Figtree-Bold", size: 22, relativeTo: .title3))
                .foregroundStyle(.black).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if !invite.message.isEmpty {
                Text("“\(invite.message)”").font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                    .foregroundStyle(.black.opacity(0.75)).frame(maxWidth: .infinity, alignment: .leading)
            }
            Button { onOpenEvent(invite.eventID) } label: {
                HStack(spacing: 4) {
                    Text("View activity").font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).accessibilityHidden(true)
                }
                .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                .frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(DIPPressFeedbackStyle(cornerRadius: 12))
            .accessibilityLabel("View \(invite.eventTitle)")
            .accessibilityIdentifier("invitations.open.\(invite.id)")
            HStack(spacing: 10) {
                // Accept is the strong action (solid ink); Decline is the lighter secondary.
                answerButton("Accept", fill: DIPTokens.Color.navigationBackground.swiftUIColor, text: .white, busy: busy,
                             id: "invitations.accept.\(invite.id)") { answer(invite, accept: true) }
                    .disabled(refused).opacity(refused ? 0.4 : 1)
                answerButton("Decline", fill: DIPTokens.Color.surfaceMuted.swiftUIColor, text: DIPTokens.Color.textPrimary.swiftUIColor,
                             busy: false, id: "invitations.decline.\(invite.id)") { answer(invite, accept: false) }
            }
            .disabled(busy)
            if let failure {
                InviteNotice(text: refused ? "\(failure.message) You can decline this invitation." : "\(failure.message) Tap Accept to try again.",
                             identifier: "invitations.error.\(invite.id)")
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.08), in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("invitations.card.\(invite.id)")
    }

    private func answerButton(_ title: String, fill: Color, text: Color, busy: Bool, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if busy { ProgressView().tint(text) }
                else { Text(title).font(DIPReferenceAssets.font("Figtree-Regular", size: 20)).foregroundStyle(text) }
            }
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(fill, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .accessibilityLabel(busy ? "\(title), in progress" : title)
        .accessibilityIdentifier(id)
    }

    private func answer(_ invite: DIPInvite, accept: Bool) {
        DIPHaptics.commit()
        Task {
            let reply = await model.respond(inviteID: invite.id, accept: accept)
            if reply == nil { DIPHaptics.failure(); return }
            DIPHaptics.success()
            let message = accept ? "You’re going to \(invite.eventTitle)" : "Declined \(invite.personName)’s invitation"
            AccessibilityNotification.Announcement(message).post()
            show(toast: message)
        }
    }

    /// A short confirmation (an answered invitation would otherwise just vanish). There is no undo: the server
    /// treats the first answer as final, so the toast only confirms.
    private func show(toast message: String) {
        toastTask?.cancel()
        withAnimation(InviteMotion.spring(reduceMotion: reduceMotion)) { toast = message }
        toastTask = Task {
            try? await Task.sleep(for: .seconds(3.5))
            guard !Task.isCancelled else { return }
            withAnimation(InviteMotion.spring(reduceMotion: reduceMotion)) { toast = nil }
        }
    }

    @ViewBuilder private var toastView: some View {
        if let toast {
            Text(toast).font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body)).foregroundStyle(.white)
                .multilineTextAlignment(.center).padding(.horizontal, 20).padding(.vertical, 12).frame(minHeight: 44)
                .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                .padding(.bottom, 24).padding(.horizontal, 20)
                .transition(InviteMotion.swap(reduceMotion: reduceMotion))
                .accessibilityIdentifier("invitations.toast")
        }
    }

    /// Same convention as the cards and the sent list: the person leads, the activity follows; "Going" is an outlined chip.
    private func acceptedRow(_ invite: DIPInvite) -> some View {
        Button { onOpenEvent(invite.eventID) } label: {
            HStack(alignment: .top, spacing: 12) {
                DIPMedia(invite.avatar).resizable().frame(width: 50, height: 50).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        Text(invite.personName).font(DIPReferenceAssets.font("Figtree-Bold", size: 18, relativeTo: .body)).lineLimit(1)
                        Spacer(minLength: 4)
                        statusChip("Going", color: DIPTokens.Color.eventsAccent.swiftUIColor)
                    }
                    Text("\(invite.eventTitle) · \(DIPInviteInbox.shortWhenText(invite.eventStart))")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 16, relativeTo: .callout)).foregroundStyle(.secondary)
                        .lineLimit(1).truncationMode(.tail)
                }
                .foregroundStyle(.black)
            }
            .frame(minHeight: 75).contentShape(Rectangle())
        }
        .buttonStyle(DIPPressFeedbackStyle(cornerRadius: 12))
        .accessibilityLabel("Going to \(invite.eventTitle), invited by \(invite.personName)")
        .accessibilityHint("Open activity")
        .accessibilityIdentifier("invitations.going.\(invite.id)")
    }

    /// An accepted invitation whose activity the member has since left: informational "Cancelled" chip and a solid Rejoin pill.
    private func cancelledRow(_ invite: DIPInvite) -> some View {
        let busy = model.rejoining.contains(invite.id)
        let failure = model.rejoinErrors[invite.id]
        // Full may clear when someone leaves, so Rejoin stays on; closed, cancelled or gone will not come back.
        let blocked = failure.map { $0 != .full && !$0.isRetryable } ?? false
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                DIPMedia(invite.avatar).resizable().frame(width: 50, height: 50).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        Text(invite.personName).font(DIPReferenceAssets.font("Figtree-Bold", size: 18, relativeTo: .body)).lineLimit(1)
                        Spacer(minLength: 4)
                        statusChip("Cancelled", color: Color.black.opacity(0.5))
                    }
                    Text("\(invite.eventTitle) · \(DIPInviteInbox.shortWhenText(invite.eventStart))")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 16, relativeTo: .callout)).foregroundStyle(.secondary)
                        .lineLimit(1).truncationMode(.tail)
                }
                .foregroundStyle(.black)
            }
            HStack {
                Spacer(minLength: 0)
                Button { rejoin(invite) } label: {
                    Group {
                        if busy { ProgressView().tint(.white) }
                        else { Text("Rejoin").font(DIPReferenceAssets.font("Figtree-Regular", size: 18)).foregroundStyle(.white) }
                    }
                    .frame(width: 120, height: 44)
                    .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(DIPPressFeedbackStyle())
                .disabled(busy || blocked).opacity(blocked ? 0.4 : 1)
                .accessibilityLabel(busy ? "Rejoin \(invite.eventTitle), in progress" : "Rejoin \(invite.eventTitle)")
                .accessibilityIdentifier("invitations.rejoin.\(invite.id)")
            }
            if let failure {
                InviteNotice(text: blocked ? failure.message : failure.isRetryable ? "\(failure.message) Tap Rejoin to try again." : "\(failure.message) Check back if a spot opens.",
                             identifier: "invitations.rejoin.error.\(invite.id)")
            }
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("invitations.cancelled.\(invite.id)")
    }

    private func rejoin(_ invite: DIPInvite) {
        DIPHaptics.commit()
        Task {
            let rejoined = await model.rejoin(invite, perform: onRejoin)
            guard rejoined else { DIPHaptics.failure(); return }
            DIPHaptics.success()
            let message = "You’re going to \(invite.eventTitle) again"
            AccessibilityNotification.Announcement(message).post()
            show(toast: message)
        }
    }

    /// Informational (outlined): not a button.
    private func statusChip(_ title: String, color: Color) -> some View {
        Text(title).font(DIPReferenceAssets.font("Inter-Regular", size: 14)).foregroundStyle(color).lineLimit(1)
            .padding(.horizontal, 14).frame(minHeight: 32)
            .overlay(Capsule().strokeBorder(color, lineWidth: 2))
            .accessibilityHidden(true)
    }

    // MARK: Sent

    @ViewBuilder private func sent(_ inbox: DIPInviteInbox) -> some View {
        if inbox.sent.isEmpty {
            DIPEmptyState(screen: "invitations-sent", title: "You haven’t invited anyone",
                          message: "Open an activity and choose Invite a Coworker.")
        } else {
            VStack(spacing: 0) {
                ForEach(inbox.sent) { invite in
                    sentRow(invite, label: inbox.label(for: invite))
                        .transition(InviteMotion.exit(reduceMotion: reduceMotion))
                    if invite.id != inbox.sent.last?.id { Divider() }
                }
            }
            .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: inbox.sent.map { "\($0.id)\($0.status.rawValue)" })
        }
    }

    private func sentRow(_ invite: DIPInvite, label: DIPInviteStatusLabel) -> some View {
        Button { onOpenEvent(invite.eventID) } label: {
            HStack(alignment: .top, spacing: 12) {
                DIPMedia(invite.avatar).resizable().frame(width: 50, height: 50).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        Text(invite.personName).font(DIPReferenceAssets.font("Figtree-Bold", size: 18, relativeTo: .body)).lineLimit(1)
                        Spacer(minLength: 4)
                        statusChip(label.rawValue, color: color(label))
                    }
                    Text("\(invite.eventTitle) · \(DIPInviteInbox.shortWhenText(invite.eventStart))")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 16, relativeTo: .callout)).foregroundStyle(.secondary)
                        .lineLimit(1).truncationMode(.tail)
                }
                .foregroundStyle(.black)
            }
            .frame(minHeight: 75).contentShape(Rectangle())
        }
        .buttonStyle(DIPPressFeedbackStyle(cornerRadius: 12))
        .accessibilityLabel("\(invite.personName), \(invite.eventTitle), \(label.rawValue)")
        .accessibilityHint("Open activity")
        .accessibilityIdentifier("invitations.sent.\(invite.id)")
    }

    private func color(_ label: DIPInviteStatusLabel) -> Color {
        switch label {
        case .pending: DIPTokens.Color.actionPrimary.swiftUIColor
        case .accepted: DIPTokens.Color.eventsAccent.swiftUIColor
        case .declined, .expired: Color.black.opacity(0.5)
        }
    }
}
