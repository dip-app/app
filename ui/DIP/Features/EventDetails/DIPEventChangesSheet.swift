import DIPCore
import DIPDesignSystem
import SwiftUI

/// "What changed": the organizer's edits to this activity, newest first (from `Event.changeLog`).
/// No loading or offline state: the log arrives with the event document that is already on screen.
struct DIPEventChangesSheet: View {
    let eventTitle: String
    let log: [DIPChangeLogEntry]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                if log.isEmpty {
                    DIPEmptyState(screen: "event-changes", title: String(localized: "event.changes.empty.title", defaultValue: "No changes since it was posted", comment: "Empty state title in the What changed sheet"),
                                  message: String(localized: "event.changes.empty.message", defaultValue: "If the organizer changes the time, place or cost, you’ll see it here.", comment: "Empty state message in the What changed sheet"))
                        .padding(20)
                } else {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        ForEach(Array(DIPChangeLogText.newestFirst(log).enumerated()), id: \.offset) { index, entry in
                            card(entry, isLatest: index == 0).accessibilityIdentifier("event.changes.entry.\(index)")
                        }
                    }
                    .padding(20)
                }
            }
            .background(DIPTokens.Color.surfaceDefault.swiftUIColor)
            .navigationTitle("What changed")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 2) {
                        Text("What changed")
                            .font(DIPReferenceAssets.font("Figtree-Bold", size: 18, relativeTo: .headline))
                        Text(eventTitle)
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 12, relativeTo: .caption))
                            .foregroundStyle(.secondary).lineLimit(1)
                    }
                    .accessibilityElement(children: .combine)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { dismiss() } label: {
                        Text("Done").font(DIPReferenceAssets.font("Inter-Regular", size: 14)).foregroundStyle(.white)
                            .padding(.horizontal, 20).frame(height: 40)
                            .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                            .dipHitSlop(vertical: 2)
                    }
                    .buttonStyle(DIPPressFeedbackStyle())
                    .accessibilityIdentifier("event.changes.done")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .tint(DIPTokens.Color.navigationBackground.swiftUIColor)
        .preferredColorScheme(.light)
        .accessibilityIdentifier("event.changes.sheet")
    }

    private func card(_ entry: DIPChangeLogEntry, isLatest: Bool) -> some View {
        let rows = DIPChangeLogText.rows(entry)
        let when = entry.at.formatted(date: .abbreviated, time: .shortened)
        let summary = rows.map { [$0.label, $0.detail].compactMap { $0 }.joined(separator: " ") }.joined(separator: ", ")
        let relative = entry.at.formatted(.relative(presentation: .named))
        let relativeText: String = relative.prefix(1).uppercased() + relative.dropFirst()
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Text(String(localized: "event.changes.entry.header", defaultValue: "\(relativeText) · Edited by the organizer", comment: "Header of one change card in the What changed sheet; first argument is the capitalized relative time such as Yesterday or 2 hours ago"))
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .caption))
                    .foregroundStyle(.black.opacity(0.6))
                Spacer(minLength: 0)
                if isLatest {
                    Text("Latest").font(DIPReferenceAssets.font("Inter-Regular", size: 12, relativeTo: .caption))
                        .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                        .padding(.horizontal, 10).padding(.vertical, 3)
                        .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 1.5))
                }
            }
            ForEach(rows) { row in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: Self.symbol(row.key))
                        .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                        .frame(width: 22).padding(.top, 2).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(row.label).font(DIPReferenceAssets.font("Figtree-Bold", size: 16, relativeTo: .headline))
                        if let old = row.old {
                            Text(old).strikethrough().foregroundStyle(.secondary)
                                .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                        }
                        if let new = row.new {
                            Text(new).font(DIPReferenceAssets.font("Inter-Medium", size: 15, relativeTo: .body))
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
            if rows.isEmpty {
                Text("Details updated").font(DIPReferenceAssets.font("Figtree-Bold", size: 16, relativeTo: .headline))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        // Informational, so outlined rather than filled (pill rule: solid = pressable).
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.5), lineWidth: 1.5))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(String(localized: "event.changes.entry.accessibility", defaultValue: "\(when): \(summary)", comment: "VoiceOver label of one change card; first argument is the date and time of the edit, second is the list of changed rows such as Time Mon 6 PM, Cost Free")))
    }

    /// Same icon vocabulary as the event info card.
    /// Keyed by `DIPChangeRow.key` (stable), never by the translated label.
    private static func symbol(_ key: String) -> String {
        switch key {
        case "description": "text.alignleft"
        case "time": "calendar"
        case "location": "mappin.and.ellipse"
        case "cost": "ticket"
        case "spots": "person.2"
        case "name": "textformat"
        case "setting": "sun.max"
        case "cancelled": "xmark.circle"
        case "backOn": "arrow.uturn.backward.circle"
        case "photo": "photo"
        case "interests": "tag"
        default: "pencil"
        }
    }
}
