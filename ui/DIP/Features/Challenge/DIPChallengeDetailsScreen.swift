import DIPCore
import DIPDesignSystem
import SwiftUI

/// Figma Event Page (challenge) 160:6357: the event page layout with "People that completed"
/// and an "Add Your Entry" action. Participation state is repository-owned.
struct DIPChallengeDetailsScreen: View {
    let challenge: DIPChallengeDetail
    let onBack: () -> Void
    let onCompleted: () -> Void
    let onJoin: () -> Void
    let onLeave: () -> Void
    @State private var confirmingLeave = false

    var body: some View {
        ZStack(alignment: .top) {
            Color.white
            VStack(spacing: 0) {
                DIPDetailHeader(timing: challenge.timing, identifierPrefix: "challenge", onBack: onBack)
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        DIPDetailHero(image: challenge.image, tags: challenge.tags, identifierPrefix: "challenge",
                                      artworkBackground: Color(red: 250 / 255, green: 114 / 255, blue: 230 / 255))
                        VStack(alignment: .leading, spacing: 20) {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(challenge.title.uppercased())
                                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40, relativeTo: .largeTitle))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .accessibilityIdentifier("challenge.title")
                                Text(challenge.description)
                                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                                    .lineSpacing(1.0566566)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .foregroundStyle(.black)
                            .padding(.top, 10)
                            VStack(alignment: .leading, spacing: 10) {
                                DIPDetailPeopleRow(
                                    title: "People that completed", avatars: challenge.completedAvatars,
                                    total: challenge.completedCount,
                                    emptyTitle: "Be the first to finish",
                                    emptyText: "People who complete this challenge will show up here.",
                                    identifierPrefix: "challenge", onMore: onCompleted)
                                DIPDetailActionRow(
                                    isParticipating: challenge.isJoined, canChange: true,
                                    joinTitle: "Join Challenge", leaveTitle: "Leave Challenge",
                                    shareItem: "\(challenge.title) — \(challenge.timing)",
                                    shareTitle: "Share Challenge", identifierPrefix: "challenge",
                                    onJoin: onJoin, onLeave: { confirmingLeave = true })
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 130)
                }
                .scrollIndicators(.hidden)
            }
            .padding(.bottom, 22)
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
        .confirmationDialog("Leave this challenge?", isPresented: $confirmingLeave, titleVisibility: .visible) {
            Button("Leave Challenge", role: .destructive, action: onLeave)
            Button("Stay in", role: .cancel) {}
        }
    }
}
