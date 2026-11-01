import DIPCore
import DIPDesignSystem
import SwiftUI

/// Native design-system composition; no high-fidelity chat frame was supplied.
/// Conversation values arrive through repository observation, never a local append.
struct DIPActivityChatScreen: View {
    let eventTitle: String
    let messages: [DIPMessage]
    let currentUserID: String
    let onSend: (_ messageID: String, _ text: String) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var draft = ""
    @State private var isSending = false
    @State private var sendError: String?
    @State private var retryIntent: SendIntent?

    private static let maximumLength = 2_000
    private static let bottomAnchor = "chat-bottom"

    private struct SendIntent {
        let id: String
        let text: String
    }

    private var trimmedDraft: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSend: Bool {
        !isSending && !trimmedDraft.isEmpty && draft.count <= Self.maximumLength
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        if messages.isEmpty {
                            emptyConversation
                        } else {
                            ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                                if startsNewDay(at: index) {
                                    dateSeparator(message.createdAt)
                                }
                                messageRow(message)
                            }
                        }
                        Color.clear.frame(height: 1).id(Self.bottomAnchor)
                    }
                    .padding(20)
                }
                .scrollDismissesKeyboard(.interactively)
                .accessibilityIdentifier("event.chat.messages")
                .background(DIPTokens.Color.surfaceDefault.swiftUIColor)
                .safeAreaInset(edge: .bottom, spacing: 0) { composer }
                .onAppear { scroll.scrollTo(Self.bottomAnchor, anchor: .bottom) }
                .onChange(of: messages.map(\.id)) { _, _ in
                    scrollToBottom(scroll)
                }
            }
            .navigationTitle("Activity Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 2) {
                        Text("Activity Chat")
                            .font(DIPReferenceAssets.font("Figtree-Bold", size: 18, relativeTo: .headline))
                        Text(eventTitle)
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 12, relativeTo: .caption))
                            .foregroundStyle(.secondary).lineLimit(1)
                    }
                    .accessibilityElement(children: .combine)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("event.chat.done")
                }
            }
        }
        .tint(DIPTokens.Color.navigationBackground.swiftUIColor)
        .preferredColorScheme(.light)
    }

    private var emptyConversation: some View {
        VStack(spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 34)).foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                .accessibilityHidden(true)
            Text("Start the conversation")
                .font(DIPReferenceAssets.font("Figtree-Bold", size: 22, relativeTo: .title2))
            Text("Say hello to the people joining \(eventTitle).")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 60)
        .accessibilityIdentifier("event.chat.empty")
    }

    private func dateSeparator(_ date: Date) -> some View {
        Text(date.formatted(date: .abbreviated, time: .omitted))
            .font(DIPReferenceAssets.font("Inter-Regular", size: 12, relativeTo: .caption))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: Capsule())
            .frame(maxWidth: .infinity)
    }

    private func startsNewDay(at index: Int) -> Bool {
        index == 0 || !Calendar.current.isDate(messages[index - 1].createdAt, inSameDayAs: messages[index].createdAt)
    }

    private func messageRow(_ message: DIPMessage) -> some View {
        DIPConversationBubble(
            authorName: message.authorName, text: message.text, timestamp: message.createdAt,
            isOwn: message.authorID == currentUserID,
            avatar: { DIPMedia(message.authorAvatar).scaledToFill() }
        )
        .accessibilityIdentifier("event.chat.message.\(message.id)")
    }

    private var composer: some View {
        DIPMessageComposer(
            text: $draft, placeholder: "Message", isSending: isSending,
            errorMessage: sendError, identifierPrefix: "event.chat", onSend: send
        )
        .onChange(of: draft) { _, _ in sendError = nil }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .background(.bar)
    }

    private func scrollToBottom(_ scroll: ScrollViewProxy) {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
            scroll.scrollTo(Self.bottomAnchor, anchor: .bottom)
        }
    }

    private func send() {
        guard canSend else { return }
        let text = trimmedDraft
        let intent =
            retryIntent.flatMap { $0.text == text ? $0 : nil }
            ?? SendIntent(id: UUID().uuidString, text: text)
        retryIntent = intent
        sendError = nil
        isSending = true
        Task { @MainActor in
            defer { isSending = false }
            do {
                try await onSend(intent.id, intent.text)
                // Only observation updates `messages`; a command acknowledgement clears the composer.
                if trimmedDraft == intent.text { draft = "" }
                retryIntent = nil
            } catch {
                sendError = "Your message couldn’t be sent. Try again."
            }
        }
    }
}
