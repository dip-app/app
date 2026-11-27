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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

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
                segments: [.init(id: Tab.received, title: model.badgeCount > 0 ? String(localized: "invitations.tab.receivedCount", defaultValue: "Received (\(model.badgeCount))", comment: "Invitations tab title with unread count; %lld = number of pending invitations") : String(localized: "invitations.tab.received", defaultValue: "Received", comment: "Invitations tab title for invitations the member received"), identifier: "invitations.segment.received"),
                           .init(id: Tab.sent, title: String(localized: "invitations.tab.sent", defaultValue: "Sent", comment: "Invitations tab title for invitations the member sent"), identifier: "invitations.segment.sent")],
                selection: tab, accent: DIPTokens.Color.actionPrimary.swiftUIColor, height: 50, fontSize: 18
            ) { newTab in
                // Switching tabs is navigation: silent.
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { tab = newTab }
            }
            .padding(.horizontal, 20)
            if model.isStale { offlineBanner.padding(.horizontal, 20).padding(.top, 10) }
            ScrollView {
                content.padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .refreshable {
                onRetry()
                await DIPNotificationsScreen.settle { model.invites == nil && model.phase == .loading }
            }
        }
        .background(.white)
        .preferredColorScheme(.light)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .safeAreaInset(edge: .bottom, spacing: 0) { toastView }
        .task(id: nextBoundary) {
            // Rows for an activity that starts are dropped by the inbox; re-evaluate at that moment so they animate out.
            guard let boundary = nextBoundary else { return }
            try? await Task.sleep(for: .seconds(max(0, boundary.timeIntervalSinceNow) + 0.5))
            guard !Task.isCancelled else { return }
            withAnimation(InviteMotion.spring(reduceMotion: reduceMotion)) { graceTick += 1 }
        }
        .task(id: model.graceStamp) {
            guard model.graceStamp > 0 else { return }
            try? await Task.sleep(for: .seconds(DIPInvitesModel.acceptanceGrace + 0.5))
            graceTick += 1
        }
    }

    private var header: some View {
        InviteSheetHeader(title: String(localized: "invitations.title", defaultValue: "Invitations", comment: "Invitations sheet title"), closeIdentifier: "invitations.close", onClose: onClose)
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
            .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: model.inbox(rsvp: rsvp).isEmptyReceived)
            .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: model.invites == nil)
            .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: tab)
    }

    @ViewBuilder private var stateContent: some View {
        if model.invites == nil {
            switch model.phase {
            case .failed(let message):
                DIPEmptyState(screen: "invitations-error", title: String(localized: "invitations.error.title", defaultValue: "Couldn’t load invitations", comment: "Invitations: error state title"), message: message, faces: 3,
                              tone: .failure, actionTitle: String(localized: "invites.retry", defaultValue: "Try again", comment: "Invitations: retry button on an error state"), action: { DIPHaptics.commit(); onRetry() })
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

    /// The next moment an upcoming received invitation's activity starts (after which its row leaves the lists).
    private var nextBoundary: Date? {
        let now = Date()
        return (model.invites?.received ?? []).map(\.eventStart).filter { $0 > now }.min()
    }

    private var loading: some View {
        VStack(spacing: 12) {
            // Shaped like an invitation card: inviter row, activity title, note, then the two answer buttons.
            ForEach(0..<2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        DIPSkeleton(cornerRadius: -1).frame(width: 36, height: 36)
                        VStack(alignment: .leading, spacing: 6) {
                            DIPSkeleton(cornerRadius: -1).frame(width: 150, height: 14)
                            DIPSkeleton(cornerRadius: -1).frame(width: 70, height: 10)
                        }
                    }
                    DIPSkeleton(cornerRadius: -1).frame(width: 130, height: 18)
                    DIPSkeleton(cornerRadius: -1).frame(maxWidth: .infinity).frame(height: 12)
                    HStack(spacing: 10) {
                        DIPSkeleton(cornerRadius: -1).frame(height: 44)
                        DIPSkeleton(cornerRadius: -1).frame(height: 44)
                    }
                }
                .padding(14)
                .background(
                    DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.05),
                    in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading invitations")
        .accessibilityIdentifier("invitations.loading")
    }

    // MARK: Received

    @ViewBuilder private func received(_ inbox: DIPInviteInbox) -> some View {
        if inbox.isEmptyReceived {
            DIPEmptyState(screen: "invitations-received", title: String(localized: "invitations.received.empty.title", defaultValue: "No invitations yet", comment: "Invitations received: empty state title"),
                          message: String(localized: "invitations.received.empty.message", defaultValue: "When a coworker invites you to an activity, it shows up here.", comment: "Invitations received: empty state message"))
                .transition(.opacity)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(inbox.pending) { invite in
                    receivedCard(invite).transition(InviteMotion.exit(reduceMotion: reduceMotion))
                }
                if !inbox.accepted.isEmpty {
                    Text("Going", comment: "Invitations received: section header for accepted invitations").font(DIPReferenceAssets.font("Figtree-Regular", size: 18)).foregroundStyle(.black)
                        .padding(.top, 8).accessibilityAddTraits(.isHeader)
                        .transition(.opacity)
                    ForEach(inbox.accepted) { invite in
                        acceptedRow(invite).transition(InviteMotion.exit(reduceMotion: reduceMotion))
                    }
                }
                if !inbox.cancelled.isEmpty {
                    Text("Cancelled", comment: "Invitations received: section header for invitations the member cancelled their RSVP for").font(DIPReferenceAssets.font("Figtree-Regular", size: 18)).foregroundStyle(.black)
                        .padding(.top, 8).accessibilityAddTraits(.isHeader)
                        .accessibilityLabel("Cancelled: you cancelled your RSVP")
                        .transition(.opacity)
                    ForEach(inbox.cancelled) { invite in
                        cancelledRow(invite).transition(InviteMotion.exit(reduceMotion: reduceMotion))
                    }
                }
            }
            // Accepting or declining animates the card out (or into Going) and closes the gap below it.
            .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: inbox.pending.map(\.id) + inbox.accepted.map(\.id) + inbox.cancelled.map { "c\($0.id)" })
            .transition(.opacity)
        }
    }

    private func receivedCard(_ invite: DIPInvite) -> some View {
        let busy = model.answering.contains(invite.id)
        let failure = model.answerErrors[invite.id]
        // A definite refusal (full, started, cancelled, gone) will not succeed on a second tap: Accept stays off.
        let answered = failure == .alreadyAnswered
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
            if answered {
                // Answered elsewhere (another device, an earlier tap): nothing left to do. No buttons, no "you can decline".
                Text("Already answered")
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .footnote))
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.7))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("invitations.answered.\(invite.id)")
            } else {
                HStack(spacing: 10) {
                    // Accept is the strong action (solid ink); Decline is the lighter secondary.
                    answerButton(String(localized: "invitations.accept", defaultValue: "Accept", comment: "Invitations: button to accept an invitation"), fill: DIPTokens.Color.navigationBackground.swiftUIColor, text: .white, busy: busy,
                                 id: "invitations.accept.\(invite.id)") { answer(invite, accept: true) }
                        .disabled(refused).opacity(refused ? 0.4 : 1)
                    answerButton(String(localized: "invitations.decline", defaultValue: "Decline", comment: "Invitations: button to decline an invitation"), fill: DIPTokens.Color.surfaceMuted.swiftUIColor, text: DIPTokens.Color.textPrimary.swiftUIColor,
                                 busy: false, id: "invitations.decline.\(invite.id)") { answer(invite, accept: false) }
                }
                .disabled(busy)
                if let failure {
                    InviteNotice(text: refused ? String(localized: "invitations.error.refused", defaultValue: "\(failure.message) You can decline this invitation.", comment: "Invitations: error under a card that cannot be accepted; %@ = reason sentence") : String(localized: "invitations.error.retryAccept", defaultValue: "\(failure.message) Tap Accept to try again.", comment: "Invitations: error under a card where accepting may work on retry; %@ = reason sentence"),
                                 identifier: "invitations.error.\(invite.id)")
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.08), in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card))
        .onChange(of: failure) { _, new in
            if let new { AccessibilityNotification.Announcement(new == .alreadyAnswered ? String(localized: "invitations.answered", defaultValue: "Already answered", comment: "Invitations: shown when the invitation was already answered elsewhere") : new.message).post() }
        }
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
        .accessibilityLabel(busy ? String(localized: "invitations.button.inProgress", defaultValue: "\(title), in progress", comment: "VoiceOver label for a button that is working; %@ = button title") : title)
        .accessibilityIdentifier(id)
    }

    private func answer(_ invite: DIPInvite, accept: Bool) {
        // A second tap while the first is in flight is ignored: no haptic, no failure.
        guard !model.answering.contains(invite.id) else { return }
        DIPHaptics.commit()
        Task {
            let reply = await model.respond(inviteID: invite.id, accept: accept)
            if reply == nil {
                if model.answerErrors[invite.id] != nil { DIPHaptics.failure() }
                return
            }
            DIPHaptics.success()
            let message = accept ? String(localized: "invitations.toast.accepted", defaultValue: "You’re going to \(invite.eventTitle)", comment: "Toast and announcement after accepting an invitation; %@ = activity title") : String(localized: "invitations.toast.declined", defaultValue: "Declined \(invite.personName)’s invitation", comment: "Toast and announcement after declining; %@ = name of the person who invited")
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
                .padding(.vertical, 12).padding(.horizontal, 20)
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
                    nameAndChip {
                        Text(invite.personName).font(DIPReferenceAssets.font("Figtree-Bold", size: 18, relativeTo: .body)).dipLineLimit(1)
                        Spacer(minLength: 4)
                        statusChip(String(localized: "invitations.chip.going", defaultValue: "Going", comment: "Invitations: outlined chip on an accepted invitation"), color: DIPTokens.Color.eventsAccent.swiftUIColor)
                    }
                    Text("\(invite.eventTitle) · \(DIPInviteInbox.shortWhenText(invite.eventStart))")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 16, relativeTo: .callout)).foregroundStyle(.secondary)
                        .dipLineLimit(1).truncationMode(.tail)
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
        let reason = failure.map { blocked ? $0.message : $0.isRetryable ? String(localized: "invitations.rejoin.retry", defaultValue: "\($0.message) Tap Rejoin to try again.", comment: "Invitations: rejoin error that may work on retry; %@ = reason sentence") : String(localized: "invitations.rejoin.checkBack", defaultValue: "\($0.message) Check back if a spot opens.", comment: "Invitations: rejoin error when the activity is full; %@ = reason sentence") }
        return HStack(alignment: .top, spacing: 12) {
            DIPMedia(invite.avatar).resizable().frame(width: 50, height: 50).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                VStack(alignment: .leading, spacing: 0) {
                    nameAndChip {
                        Text(invite.personName).font(DIPReferenceAssets.font("Figtree-Bold", size: 18, relativeTo: .body)).dipLineLimit(1)
                        Spacer(minLength: 4)
                        statusChip(String(localized: "invitations.chip.cancelled", defaultValue: "Cancelled", comment: "Invitations: outlined chip when the member cancelled their RSVP"), color: Color.black.opacity(0.62), spoken: String(localized: "invitations.chip.cancelled.spoken", defaultValue: "You cancelled your RSVP", comment: "VoiceOver label of the Cancelled chip"))
                    }
                    Text("\(invite.eventTitle) · \(DIPInviteInbox.shortWhenText(invite.eventStart))")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 16, relativeTo: .callout)).foregroundStyle(.secondary)
                        .dipLineLimit(1).truncationMode(.tail)
                }
                .foregroundStyle(.black)
                if let reason { InviteNotice(text: reason, identifier: "invitations.rejoin.error.\(invite.id)") }
                HStack {
                    Spacer(minLength: 0)
                    Button { rejoin(invite) } label: {
                        Group {
                            if busy { ProgressView().tint(.white) }
                            else { Text("Rejoin").font(DIPReferenceAssets.font("Figtree-Regular", size: 18)).foregroundStyle(.white) }
                        }
                        .dipFixedFrame(width: 120, height: 44)
                        .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                        .contentShape(Capsule())
                    }
                    .buttonStyle(DIPPressFeedbackStyle())
                    .disabled(busy || blocked).opacity(blocked ? 0.4 : 1)
                    .accessibilityLabel(busy ? String(localized: "invitations.rejoin.a11y.busy", defaultValue: "Rejoin \(invite.eventTitle), in progress", comment: "VoiceOver label of the Rejoin button while working; %@ = activity title") : String(localized: "invitations.rejoin.a11y", defaultValue: "Rejoin \(invite.eventTitle)", comment: "VoiceOver label of the Rejoin button; %@ = activity title"))
                    // VoiceOver reads why Rejoin is off.
                    .accessibilityHint(blocked ? (reason ?? "") : "")
                    .accessibilityIdentifier("invitations.rejoin.\(invite.id)")
                }
            }
        }
        .padding(.vertical, 8)
        .onChange(of: failure) { _, new in
            if let new { AccessibilityNotification.Announcement(new.message).post() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("invitations.cancelled.\(invite.id)")
    }

    private func rejoin(_ invite: DIPInvite) {
        guard !model.rejoining.contains(invite.id) else { return }
        DIPHaptics.commit()
        Task {
            let rejoined = await model.rejoin(invite, perform: onRejoin)
            guard rejoined else {
                if model.rejoinErrors[invite.id] != nil { DIPHaptics.failure() }
                return
            }
            DIPHaptics.success()
            let message = String(localized: "invitations.toast.rejoined", defaultValue: "You’re going to \(invite.eventTitle) again", comment: "Toast and announcement after rejoining an activity; %@ = activity title")
            AccessibilityNotification.Announcement(message).post()
            show(toast: message)
        }
    }

    /// Name and status chip share a line normally; at accessibility sizes the chip drops below the name.
    private func nameAndChip<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(spacing: 8))
        return layout { content() }
    }

    /// Informational (outlined): not a button.
    private func statusChip(_ title: String, color: Color, spoken: String? = nil) -> some View {
        Text(title).font(DIPReferenceAssets.font("Inter-Regular", size: 14)).foregroundStyle(color).dipLineLimit(1)
            .padding(.horizontal, 14).frame(minHeight: 32)
            .overlay(Capsule().strokeBorder(color, lineWidth: 2))
            .accessibilityHidden(spoken == nil)
            .accessibilityLabel(spoken ?? title)
    }

    // MARK: Sent

    @ViewBuilder private func sent(_ inbox: DIPInviteInbox) -> some View {
        if inbox.sent.isEmpty {
            DIPEmptyState(screen: "invitations-sent", title: String(localized: "invitations.sent.empty.title", defaultValue: "You haven’t invited anyone", comment: "Invitations sent: empty state title"),
                          message: String(localized: "invitations.sent.empty.message", defaultValue: "Open an activity and choose Invite a Coworker.", comment: "Invitations sent: empty state message"))
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
                    nameAndChip {
                        Text(invite.personName).font(DIPReferenceAssets.font("Figtree-Bold", size: 18, relativeTo: .body)).dipLineLimit(1)
                        Spacer(minLength: 4)
                        statusChip(label.localizedTitle, color: color(label))
                    }
                    Text("\(invite.eventTitle) · \(DIPInviteInbox.shortWhenText(invite.eventStart))")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 16, relativeTo: .callout)).foregroundStyle(.secondary)
                        .dipLineLimit(1).truncationMode(.tail)
                }
                .foregroundStyle(.black)
            }
            .frame(minHeight: 75).contentShape(Rectangle())
        }
        .buttonStyle(DIPPressFeedbackStyle(cornerRadius: 12))
        .accessibilityLabel("\(invite.personName), \(invite.eventTitle), \(label.localizedTitle)")
        .accessibilityHint("Open activity")
        .accessibilityIdentifier("invitations.sent.\(invite.id)")
    }

    private func color(_ label: DIPInviteStatusLabel) -> Color {
        switch label {
        case .pending: DIPTokens.Color.actionPrimary.swiftUIColor
        case .accepted: DIPTokens.Color.eventsAccent.swiftUIColor
        case .declined, .expired: Color.black.opacity(0.62)
        }
    }
}
