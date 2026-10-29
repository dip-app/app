import DIPDesignSystem
import SwiftUI

/// Synthetic presentation values. Only Puppy Yoga has a supplied detail-frame reference.
struct DIPEventDetailFixture: Identifiable, Equatable {
    let id: String
    let title: String
    let imageName: String
    let timing: String
    let description: String
    let tags: [String]

    static let puppyYoga = DIPEventDetailFixture(
        id: "puppy-yoga", title: "Puppy Yoga", imageName: "event_Image", timing: "Happening 3/09",
        description:
            "Join us for a delightful puppy yoga session where you can stretch, relax, and bond with adorable puppies! Experience the joy of  yoga surrounded by puppies who will bring smiles and laughter to your practice. This session combines gentle yoga poses with the heartwarming presence of our furry friends.",
        tags: ["Fitness", "Energetic", "Hype"])

    static func named(_ name: String) -> DIPEventDetailFixture {
        let normalized = name.lowercased().filter { $0.isLetter || $0.isNumber }
        let row: (String, String, String, [String])
        switch normalized {
        case "kayaking", "kayak":
            row = ("kayaking", "Kayaking", "EventCard1", ["Outdoors", "Adventure", "Fitness"])
        case "hike", "hiking":
            row = ("hike", "Hike", "EventCard2", ["Outdoors", "Adventure", "Fitness"])
        case "gamecafe", "gamecafé":
            row = ("game-cafe", "Game Cafe", "events_Rectangle931", ["Games", "Social", "Fun"])
        case "mountdiablohike", "mountdiablo":
            row = (
                "mount-diablo-hike", "Mount Diablo Hike", "events_Rectangle932", ["Outdoors", "Adventure", "Fitness"]
            )
        case "cookingclass", "cooking":
            row = ("cooking-class", "Cooking Class", "events_Rectangle933", ["Cooking", "Social", "Fun"])
        default:
            return .puppyYoga
        }
        return DIPEventDetailFixture(
            id: row.0, title: row.1, imageName: row.2, timing: "Happening 3/09",
            description:
                "Spend time with your coworkers and enjoy \(row.1.lowercased()) together. Meet new people, share a fun experience, and make memories with your team.",
            tags: row.3)
    }
}

/// Figma Event Page 46:1397 and Joined 76:1742, with local-only participation/chat state.
struct DIPEventDetailsScreen: View {
    let event: DIPEventDetailFixture
    let onBack: () -> Void
    let onAttendees: () -> Void
    let onJoined: (Bool) -> Void
    @State private var joined: Bool
    @State private var showChat = false

    init(
        event: DIPEventDetailFixture = .puppyYoga,
        initiallyJoined: Bool = false,
        onBack: @escaping () -> Void,
        onAttendees: @escaping () -> Void,
        onJoined: @escaping (Bool) -> Void = { _ in }
    ) {
        self.event = event
        self.onBack = onBack
        self.onAttendees = onAttendees
        self.onJoined = onJoined
        _joined = State(initialValue: initiallyJoined)
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Color.white
                VStack(spacing: 0) {
                    header
                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            hero
                            VStack(alignment: .leading, spacing: 20) {
                                activityDetails
                                attendeeDetails
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 130)
                    }
                    .scrollIndicators(.hidden)
                }
                .padding(.bottom, 22)
                Button(action: primaryAction) {
                    Text(joined ? "Activity Chat" : "Join the Activity")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 24))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity).frame(height: 80)
                        .background(
                            joined
                                ? DIPTokens.Color.actionPrimary.swiftUIColor
                                : DIPTokens.Color.navigationBackground.swiftUIColor,
                            in: Capsule()
                        )
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("event.primary")
                .accessibilityValue(joined ? "Joined" : "Not joined")
                .padding(.horizontal, 20)
                .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
            }
            .clipped()
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
        .sheet(isPresented: $showChat) {
            DIPEventChatFixture(eventTitle: event.title)
        }
    }

    private var header: some View {
        HStack {
            Button(action: onBack) {
                DIPReferenceAssets.image("event_BackButton").resizable()
                    .frame(width: 50, height: 50)
            }
            .buttonStyle(.plain).accessibilityLabel("Back")
            .accessibilityIdentifier("event.back")
            Spacer(minLength: 10)
            Text(event.timing)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(.black)
                .frame(width: 164, height: 50)
                .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
        }
        .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 10)
    }

    private var hero: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottomTrailing) {
                DIPReferenceAssets.image(event.imageName).resizable().scaledToFill()
                    .frame(width: geometry.size.width, height: 264).clipped()
                HStack(spacing: 10.435) {
                    ForEach(event.tags, id: \.self) { tag in
                        Text(tag)
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                            .foregroundStyle(.black)
                            .padding(.horizontal, 13.043)
                            .frame(height: 30)
                            .background(.white, in: Capsule())
                    }
                }
                .padding(10)
            }
            .clipShape(RoundedRectangle(cornerRadius: 20))
        }
        .frame(height: 264)
        .accessibilityIdentifier("event.hero")
    }

    private var activityDetails: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(event.title.uppercased())
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40, relativeTo: .largeTitle))
                .frame(height: 50, alignment: .leading)
                .accessibilityIdentifier("event.title")
            Text(event.description)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                // The source uses 18-point lines; Inter 3.19 has a 16.943-point natural line height.
                .lineSpacing(1.0566566)
                .frame(width: 328, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 126, alignment: .topLeading)
        }
        .foregroundStyle(.black)
        .padding(.top, 10)
    }

    private var attendeeDetails: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Who’s Attending")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                .foregroundStyle(.black).frame(height: 22)
            HStack(spacing: 10) {
                ForEach(0..<4, id: \.self) { index in
                    DIPReferenceAssets.image(attendeeAsset(index))
                        .resizable().frame(width: 40, height: 40)
                        .accessibilityHidden(true)
                }
                Button(action: onAttendees) {
                    Text(joined ? "+ 13 More" : "+ 12 More")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity).frame(height: 40)
                        .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                }
                .buttonStyle(.plain).accessibilityLabel("View attendees")
                .accessibilityIdentifier("event.attendees")
            }
            HStack(spacing: 10) {
                Button {
                    if joined { showChat = true } else { join() }
                } label: {
                    secondaryLabel(
                        "Join Activity", asset: "event_HeroiconsOutlineChatBubbleOvalLeft",
                        background: DIPTokens.Color.actionPrimary.swiftUIColor)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(joined ? "Open activity chat" : "Join Activity")
                .accessibilityValue(joined ? "Joined" : "Not joined")
                .accessibilityIdentifier("event.join")
                ShareLink(item: "\(event.title) — \(event.timing)") {
                    secondaryLabel(
                        "Share Link", asset: "event_HeroiconsMiniLink",
                        background: Color(red: 240 / 255, green: 84 / 255, blue: 165 / 255))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Share event")
                .accessibilityIdentifier("event.share")
            }
        }
    }

    private func attendeeAsset(_ index: Int) -> String {
        let prefix = joined ? "event-joined_" : "event_"
        return prefix + "CoworkerProfilePicture" + (index == 0 ? "" : "\(index)")
    }

    private func secondaryLabel(_ title: String, asset: String, background: Color) -> some View {
        HStack(spacing: 0) {
            Text(title)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity).frame(height: 29)
            DIPReferenceAssets.image(asset).resizable().frame(width: 20, height: 20)
                .frame(width: 40, height: 40)
                .background(.white, in: Circle())
        }
        .padding(5).frame(height: 50)
        .background(background, in: Capsule())
        .contentShape(Capsule())
    }

    private func join() {
        guard !joined else { return }
        joined = true
        onJoined(true)
    }

    private func primaryAction() {
        if joined { showChat = true } else { join() }
    }
}

/// Interaction fixture only. The supplied hi-fi explicitly has no chat-screen design.
struct DIPEventChatFixture: View {
    let eventTitle: String
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @State private var messages = ["Looking forward to this activity!"]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                List {
                    Section {
                        ForEach(Array(messages.enumerated()), id: \.offset) { _, message in
                            Text(message)
                        }
                    } header: {
                        Text(eventTitle)
                    } footer: {
                        Text("Preview conversation · Messages stay on this device during this session.")
                    }
                }
                HStack {
                    TextField("Message", text: $draft)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("event.chat.message")
                    Button("Send", action: send)
                        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("event.chat.send")
                }
                .padding()
            }
            .navigationTitle("Activity Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        messages.append(text)
        draft = ""
    }
}
