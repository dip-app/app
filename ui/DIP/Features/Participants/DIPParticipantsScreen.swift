import DIPDesignSystem
import SwiftUI

/// Original Participants presentation fixture. Membership and chat data remain outside this view.
struct DIPParticipantsScreen: View {
    let onBack: () -> Void
    let onChat: () -> Void

    private let people: [(name: String, department: String, avatar: String)] = [
        ("Elissa Woode", "Human Resources", "CoworkerProfilePicture"),
        ("Frank White", "Customer Support", "CoworkerProfilePicture1"),
        ("Linda Carter", "Marketing", "CoworkerProfilePicture2"),
        ("Michael Johnson", "User Experience Team", "CoworkerProfilePicture3"),
        ("Samantha Green", "Technical Assistance", "CoworkerProfilePicture4"),
        ("Robert Garcia", "Quality Assurance", "CoworkerProfilePicture5"),
        ("Patricia Lee", "Product Development", "CoworkerProfilePicture6"),
        ("Jessica Martinez", "Project Management", "CoworkerProfilePicture7"),
        ("Daniel Kim", "Sales", "CoworkerProfilePicture"),
        ("Sophia Turner", "Data Analysis", "CoworkerProfilePicture1"),
        ("Kevin Brown", "Content Creation", "CoworkerProfilePicture2"),
        ("Emily Davis", "Finance", "CoworkerProfilePicture3"),
        ("Matthew Wilson", "IT Support", "CoworkerProfilePicture4"),
        ("Ava Thompson", "Business Strategy", "CoworkerProfilePicture5"),
        ("James Rodriguez", "Research and Development", "CoworkerProfilePicture6"),
        ("Olivia White", "Social Media Management", "CoworkerProfilePicture7"),
        ("Liam Harris", "Operations", "CoworkerProfilePicture"),
    ]

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
            Text("17 Participants")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 14))
                .foregroundStyle(.black)
                .frame(height: 28.696)
                .padding(.horizontal, 30)
                .frame(height: 50)
                .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
        }
    }

    private func personRow(_ person: (name: String, department: String, avatar: String)) -> some View {
        HStack(spacing: 16) {
            DIPReferenceAssets.image("attendees_\(person.avatar)").resizable()
                .frame(width: 50, height: 50)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(person.name)
                    .font(DIPReferenceAssets.font("Figtree-Bold", size: 18))
                    .frame(height: 22, alignment: .leading)
                Text(person.department)
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                    .frame(height: 22, alignment: .leading)
            }
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 5)
        .frame(height: 75)
    }
}
