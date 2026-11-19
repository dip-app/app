import DIPCore
import DIPDesignSystem
import DIPPresentation
import SwiftUI

/// What the permission banner offers: ask for permission (never asked) or send the member to iOS Settings (denied).
enum NotificationPermissionPrompt: Equatable {
    case turnOn, openSettings
}

/// The notifications center (opened from the bell): grouped by day, one row per notification, newest first.
/// Opening a row marks it read and goes to its place. Solid pills are pressable, outlined ones inform.
/// Invitations are reached from here (a button and the invite rows), not from a tab of their own.
struct DIPNotificationsScreen: View {
    let model: DIPNotificationsModel
    /// Invitations waiting for an answer; nil when there is no invitations adapter (the button is then hidden).
    var invitesWaiting: Int?
    /// Set only when push is enabled by flag and the system permission is undetermined or denied.
    var permissionPrompt: NotificationPermissionPrompt?
    let onOpen: (DIPNotification) -> Void
    let onOpenInvitations: () -> Void
    var onPermission: () -> Void = {}
    /// "Notification settings" link under the banner action; nil hides it.
    var onOpenSettings: (() -> Void)?
    let onRetry: () -> Void
    let onClose: () -> Void
    /// Reference date for grouping and relative times; injectable for tests.
    var now: () -> Date = { Date() }
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    /// The permission banner can be put away for this visit.
    @State private var bannerDismissed = false

    var body: some View {
        VStack(spacing: 0) {
            InviteSheetHeader(title: String(localized: "notifications.title", defaultValue: "Notifications", comment: "Notifications sheet title"), closeIdentifier: "notifications.close", onClose: onClose)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if model.isStale { offlineBanner }
                    controls
                    if let permissionPrompt, !bannerDismissed { permissionBanner(permissionPrompt) }
                    stateContent
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .refreshable {
                // The restart is fire-and-forget at the call site; keep the spinner until the listener reports (or gives up).
                onRetry()
                await Self.settle { model.phase == .loading }
            }
        }
        .background(.white)
        .preferredColorScheme(.light)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        // A container, so the identifier names the sheet only: on a plain stack it replaced the identifiers of the title and
        // the Close button (notifications.close) with its own.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("notifications.screen")
    }

    /// Lets a pull-to-refresh last as long as the restarted load, at least half a second so it never flashes, at most 8 s.
    static func settle(while isLoading: @MainActor () -> Bool) async {
        try? await Task.sleep(for: .milliseconds(500))
        var waited = 0
        while isLoading(), waited < 75, !Task.isCancelled { try? await Task.sleep(for: .milliseconds(100)); waited += 1 }
    }

    // MARK: Controls

    @ViewBuilder private var controls: some View {
        let showInvites = invitesWaiting != nil
        let showMarkAll = model.phase == .ready && model.hasUnread
        if showInvites || showMarkAll {
            VStack(alignment: .leading, spacing: 8) {
                // Side by side (half width each); stacked only at accessibility text sizes.
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(spacing: 10) { buttons(showInvites: showInvites, showMarkAll: showMarkAll) }
                } else {
                    HStack(spacing: 10) { buttons(showInvites: showInvites, showMarkAll: showMarkAll) }
                }
                if let error = model.markAllError { InviteNotice(text: error, identifier: "notifications.markall.error") }
            }
        }
    }

    @ViewBuilder private func buttons(showInvites: Bool, showMarkAll: Bool) -> some View {
        if showInvites {
            pill(invitesWaiting.map { $0 > 0 ? String(localized: "notifications.invitations.count", defaultValue: "Invitations (\($0))", comment: "Notifications: invitations button with a count; %lld = invitations waiting for an answer") : String(localized: "notifications.invitations", defaultValue: "Invitations", comment: "Notifications: button that opens the invitations list") } ?? String(localized: "notifications.invitations", defaultValue: "Invitations", comment: "Notifications: button that opens the invitations list"),
                 identifier: "notifications.invitations", chevron: true) { DIPHaptics.navigate(); onOpenInvitations() }
                .accessibilityLabel(invitesWaiting.map { $0 > 0 ? String(localized: "notifications.invitations.a11y", defaultValue: "Invitations, \($0) waiting for an answer", comment: "VoiceOver label of the invitations button; %lld = invitations waiting for an answer") : String(localized: "notifications.invitations", defaultValue: "Invitations", comment: "Notifications: button that opens the invitations list") } ?? String(localized: "notifications.invitations", defaultValue: "Invitations", comment: "Notifications: button that opens the invitations list"))
        }
        if showMarkAll {
            pill(model.isMarkingAll ? String(localized: "notifications.markAll.working", defaultValue: "Marking…", comment: "Notifications: mark-all button while working") : String(localized: "notifications.markAll", defaultValue: "Mark all as read", comment: "Notifications: button that marks every notification as read"), identifier: "notifications.markall") {
                DIPHaptics.commit()
                Task {
                    let done = await model.markAllRead()
                    if done { DIPHaptics.success(); AccessibilityNotification.Announcement(String(localized: "notifications.markAll.announce", defaultValue: "All notifications marked as read", comment: "VoiceOver announcement after marking all notifications read")).post() }
                    else { DIPHaptics.failure() }
                }
            }
            .disabled(model.isMarkingAll)
        }
    }

    private func pill(_ title: String, identifier: String, chevron: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(title).font(DIPReferenceAssets.font("Figtree-Regular", size: 20, relativeTo: .title3)).lineLimit(1).minimumScaleFactor(0.7)
                if chevron { Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).accessibilityHidden(true) }
            }
                .foregroundStyle(.white)
                .padding(.horizontal, 12).frame(maxWidth: .infinity, minHeight: 50)
                .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .accessibilityIdentifier(identifier)
    }

    // MARK: Banners

    /// Informational (outlined) with one pressable action inside.
    private func permissionBanner(_ prompt: NotificationPermissionPrompt) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 8) {
                Label {
                    Text(prompt == .turnOn ? String(localized: "notifications.permission.turnOn.title", defaultValue: "Get updates when plans change", comment: "Notifications: permission banner title when permission was never asked") : String(localized: "notifications.permission.denied.title", defaultValue: "Notifications are turned off", comment: "Notifications: permission banner title when notifications are denied in iOS"))
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .headline))
                } icon: { Image(systemName: "bell.slash").accessibilityHidden(true) }
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                Spacer(minLength: 0)
                Button { DIPHaptics.select(); withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { bannerDismissed = true } } label: {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor).frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .accessibilityLabel("Dismiss").accessibilityIdentifier("notifications.permission.dismiss")
            }
            Text(prompt == .turnOn
                 ? String(localized: "notifications.permission.turnOn.message", defaultValue: "Turn on notifications and we’ll tell you when an activity changes or is about to start.", comment: "Notifications: permission banner message when permission was never asked")
                 : String(localized: "notifications.permission.denied.message", defaultValue: "You’ll still see updates here. To get them on your phone too, allow notifications in Settings.", comment: "Notifications: permission banner message when notifications are denied in iOS"))
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .footnote))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                .fixedSize(horizontal: false, vertical: true)
            pill(prompt == .turnOn ? String(localized: "notifications.permission.turnOn.button", defaultValue: "Turn on", comment: "Notifications: permission banner button that asks for permission") : String(localized: "notifications.permission.openSettings", defaultValue: "Open Settings", comment: "Notifications: permission banner button that opens iOS Settings"), identifier: "notifications.permission.action") {
                DIPHaptics.select(); onPermission()
            }
            if let onOpenSettings {
                Button { DIPHaptics.select(); onOpenSettings() } label: {
                    Text("Notification settings")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .footnote))
                        .underline()
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityIdentifier("notifications.permission.settings")
            }
        }
        .padding(16)
        .overlay(RoundedRectangle(cornerRadius: DIPTokens.Radius.card).strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("notifications.permission")
    }

    private var offlineBanner: some View {
        Label("You’re offline. Showing your last notifications.", systemImage: "wifi.slash")
            .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .footnote))
            .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
            .padding(.horizontal, 16).frame(minHeight: 44).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
            .accessibilityIdentifier("notifications.offline")
    }

    // MARK: Content

    @ViewBuilder private var stateContent: some View {
        switch model.phase {
        case .loading: loading
        case .failed(let message):
            DIPEmptyState(screen: "notifications-error", title: String(localized: "notifications.error.title", defaultValue: "Couldn’t load notifications", comment: "Notifications: error state title"), message: message, faces: 3,
                          actionTitle: String(localized: "notifications.error.retry", defaultValue: "Try again", comment: "Notifications: retry button on the error state"), action: { DIPHaptics.commit(); onRetry() })
        case .ready:
            if model.isEmpty {
                DIPEmptyState(screen: "notifications", title: String(localized: "notifications.empty.title", defaultValue: "No notifications yet", comment: "Notifications: empty state title"),
                              message: String(localized: "notifications.empty.message", defaultValue: "Updates about your activities, invitations and challenges show up here.", comment: "Notifications: empty state message"), faces: 3)
            } else { list }
        }
    }

    private var loading: some View {
        VStack(spacing: 10) {
            ForEach(0..<5, id: \.self) { _ in
                HStack(alignment: .top, spacing: 12) {
                    DIPSkeleton(cornerRadius: -1).frame(width: 44, height: 44)
                    VStack(alignment: .leading, spacing: 8) {
                        DIPSkeleton(cornerRadius: -1).frame(width: 160, height: 14)
                        DIPSkeleton(cornerRadius: -1).frame(maxWidth: .infinity).frame(height: 12)
                        DIPSkeleton(cornerRadius: -1).frame(width: 60, height: 10)
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 12).frame(maxWidth: .infinity, minHeight: 68, alignment: .leading)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading notifications")
        .accessibilityIdentifier("notifications.loading")
    }

    private var list: some View {
        let reference = now()
        let sections = model.sections()
        let positions = Dictionary(model.items.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        return VStack(alignment: .leading, spacing: 18) {
            ForEach(sections, id: \.group) { section in
                VStack(alignment: .leading, spacing: 8) {
                    Text(section.group.localizedTitle)
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .headline))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.7))
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("notifications.section.\(section.group.rawValue.lowercased())")
                    ForEach(section.items) { item in
                        row(item, now: reference)
                            .staggeredEntrance(index: positions[item.id] ?? 0)
                            .transition(InviteMotion.entrance(reduceMotion: reduceMotion))
                    }
                }
            }
            footer
        }
        .animation(InviteMotion.spring(reduceMotion: reduceMotion), value: model.items.map(\.id))
    }

    @ViewBuilder private var footer: some View {
        if model.canLoadMore {
            VStack(spacing: 8) {
                if let error = model.loadMoreError { InviteNotice(text: error, identifier: "notifications.more.error") }
                pill(model.loadingMore ? String(localized: "notifications.more.loading", defaultValue: "Loading…", comment: "Notifications: load-more button while loading") : model.loadMoreError == nil ? String(localized: "notifications.more", defaultValue: "Load more", comment: "Notifications: button to load older notifications") : String(localized: "notifications.more.retry", defaultValue: "Try again", comment: "Notifications: load-more retry after a failure"),
                     identifier: "notifications.more") { DIPHaptics.select(); Task { await model.loadMore() } }
                    .disabled(model.loadingMore)
            }
            // Reaching the end of the list loads the next page too, unless the last attempt failed.
            .onAppear { if model.loadMoreError == nil { Task { await model.loadMore() } } }
        }
    }

    // MARK: Row

    private func row(_ item: DIPNotification, now: Date) -> some View {
        let time = DIPNotificationRules.relativeTime(item.createdAt, now: now)
        let accent = Self.accent(item.kind)
        return Button { onOpen(item) } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: Self.symbol(item.kind))
                    .font(.system(size: 18, weight: .regular)).foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                    .frame(width: 44, height: 44)
                    .background(accent.opacity(0.25), in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title).font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .headline))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                        .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    if !item.body.isEmpty {
                        Text(item.body).font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                            .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.8))
                            .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    }
                    Text(time).font(DIPReferenceAssets.font("Inter-Regular", size: 12, relativeTo: .caption))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.6))
                }
                Spacer(minLength: 0)
                Circle().fill(DIPTokens.Color.actionPrimary.swiftUIColor).frame(width: 10, height: 10)
                    .padding(.top, 6).opacity(item.isRead ? 0 : 1).accessibilityHidden(true)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 68, alignment: .leading)
            .background(item.isRead ? Color.clear : DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.08),
                        in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card))
            .contentShape(RoundedRectangle(cornerRadius: DIPTokens.Radius.card))
            .animation(.easeInOut(duration: DIPMotion.reducedMotionDuration), value: item.isRead)
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(item.isRead ? "\(item.title). \(item.body) \(time)" : String(localized: "notifications.row.a11y.unread", defaultValue: "Unread: \(item.title). \(item.body) \(time)", comment: "VoiceOver label of an unread notification row; %1$@ = title, %2$@ = body, %3$@ = relative time"))
        .accessibilityHint(Self.hint(item))
        .accessibilityAddTraits(.isButton)
        .accessibilityActions {
            if !item.isRead { Button("Mark as read") { Task { await model.markRead(item.id) } } }
        }
        .accessibilityIdentifier("notifications.row.\(item.id)")
    }

    static func symbol(_ kind: DIPNotificationKind) -> String {
        switch kind {
        case .invite: "envelope"
        case .inviteAnswered: "envelope.open"
        case .eventUpdated: "calendar.badge.clock"
        case .eventCancelled: "calendar.badge.minus"
        case .reminder: "alarm"
        case .challengeApproved: "star"
        case .challengeChanges: "arrow.uturn.backward"
        case .attendeeAdded: "person.crop.circle.badge.checkmark"
        case .attendeeRemoved: "person.crop.circle.badge.minus"
        case .comment: "bubble.left"
        case .photo: "photo"
        case .other: "bell"
        }
    }

    static func accent(_ kind: DIPNotificationKind) -> Color {
        switch kind {
        case .invite, .inviteAnswered: DIPTokens.Color.actionPrimary.swiftUIColor
        case .eventUpdated, .reminder: DIPTokens.Color.notificationAccent.swiftUIColor
        case .eventCancelled, .attendeeRemoved: DIPTokens.Color.textPrimary.swiftUIColor
        case .challengeApproved, .challengeChanges: DIPTokens.Color.challengeAccent.swiftUIColor
        case .attendeeAdded: DIPTokens.Color.actionComplete.swiftUIColor
        case .comment, .photo: DIPTokens.Color.actionPrimary.swiftUIColor
        case .other: DIPTokens.Color.textPrimary.swiftUIColor
        }
    }

    /// Comments and new photos open the activity page (the push opens the same place); its album is one step away.
    static func hint(_ item: DIPNotification) -> String {
        if case .event = item.destination, item.kind == .comment || item.kind == .photo {
            return String(localized: "notifications.hint.eventAlbum", defaultValue: "Opens the activity, where you can view its album", comment: "VoiceOver hint on a photo comment or new photo notification that opens the activity page")
        }
        return hint(item.destination)
    }

    static func hint(_ destination: DIPNotificationDestination) -> String {
        switch destination {
        case .event: String(localized: "notifications.hint.event", defaultValue: "Opens the activity", comment: "VoiceOver hint on a notification that opens an activity")
        case .invitations: String(localized: "notifications.hint.invitations", defaultValue: "Opens your invitations", comment: "VoiceOver hint on a notification that opens invitations")
        case .challenge: String(localized: "notifications.hint.challenge", defaultValue: "Opens the challenge", comment: "VoiceOver hint on a notification that opens the weekly challenge")
        case .album: String(localized: "notifications.hint.album", defaultValue: "Opens the photo album", comment: "VoiceOver hint on a notification that opens a photo album")
        case .none: ""
        }
    }
}
