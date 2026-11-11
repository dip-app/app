import DIPCore
import DIPDesignSystem
import SwiftUI

/// Original Participants presentation fixture. Membership and chat data remain outside this view.
struct DIPParticipantsScreen: View {
    let showsBottomBar: Bool
    let onBack: () -> Void
    let onChat: () -> Void

    let people: [DIPParticipant]
    let participantCount: Int

    init(
        people: [DIPParticipant], participantCount: Int, showsBottomBar: Bool = true, onBack: @escaping () -> Void,
        onChat: @escaping () -> Void
    ) {
        self.people = people
        self.participantCount = participantCount
        self.showsBottomBar = showsBottomBar
        self.onBack = onBack
        self.onChat = onChat
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Color.white
                VStack(spacing: 0) {
                    header
                        .padding(.horizontal, 20)
                        .padding(.top, 60)
                        .padding(.bottom, 10)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 4) {
                            if people.isEmpty {
                                DIPEmptyState(
                                    screen: "participants", title: "No one has joined yet",
                                    message: "Coworkers who join this event will show up here.")
                                    .padding(.top, 8)
                            }
                            ForEach(Array(people.enumerated()), id: \.offset) { index, person in
                                VStack(spacing: 4) {
                                    personRow(person)
                                        .accessibilityElement(children: .combine)
                                        .accessibilityIdentifier("participants.person.\(index)")
                                    if index < people.count - 1 {
                                        Color.clear.frame(height: 0)
                                            .overlay(alignment: .top) {
                                                DIPReferenceAssets.image("attendees_Line2").resizable()
                                                    .frame(height: 1).rotationEffect(.degrees(180))
                                            }
                                            .accessibilityHidden(true)
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 122)
                    }
                    .scrollIndicators(.hidden)
                }
                .padding(.bottom, 22)
                if showsBottomBar {
                    Button(action: onChat) {
                        Text("Activity Chat")
                            .font(DIPReferenceAssets.font("Figtree-Regular", size: 24, relativeTo: .title2))
                            .foregroundStyle(.white)
                            .frame(height: 22)
                            .frame(maxWidth: .infinity)
                            .frame(height: 80)
                            .background(DIPTokens.Color.actionPrimary.swiftUIColor, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 20)
                    .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
                    .accessibilityIdentifier("participants.chat")
                }
            }
            .clipped()
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(alignment: .top) {
            Button(action: onBack) {
                DIPReferenceAssets.image("attendees_BackButton").resizable()
                    .frame(width: 50, height: 50)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close participants")
            .accessibilityIdentifier("participants.back")
            Spacer(minLength: 10)
            Text("\(participantCount) Participants")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 14))
                .foregroundStyle(.black)
                .frame(height: 28.696)
                .padding(.horizontal, 30)
                .frame(height: 50)
                .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
        }
    }

    private func personRow(_ person: DIPParticipant) -> some View {
        DIPParticipantRow(person: person)
    }
}

/// One participant: 50 pt avatar, bold name and department, 75 pt tall (Figma attendees list).
/// Shared with the onboarding B2 demo. Dividers stay with the caller.
struct DIPParticipantRow: View {
    let person: DIPParticipant

    var body: some View {
        HStack(spacing: 16) {
            DIPMedia(person.avatar).resizable()
                .frame(width: 50, height: 50)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(person.name)
                    .font(DIPReferenceAssets.font("Figtree-Bold", size: 18))
                    .frame(height: 22, alignment: .leading)
                Text(person.subtitle)
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                    .lineLimit(1).truncationMode(.tail)
                    .frame(height: 22, alignment: .leading)
            }
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 5)
        .frame(height: 75)
    }
}
