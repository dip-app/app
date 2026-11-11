#if canImport(SwiftUI)
import SwiftUI

/// Shared press feedback darkens an opaque surface instead of fading it through underlying content.
public struct DIPPressFeedbackStyle: ButtonStyle {
    /// Corner radius of the darkening overlay for rectangular surfaces such as a tappable row; nil keeps the capsule.
    private let cornerRadius: CGFloat?
    public init(cornerRadius: CGFloat? = nil) { self.cornerRadius = cornerRadius }
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay {
                Group {
                    if let cornerRadius { RoundedRectangle(cornerRadius: cornerRadius).fill(.black.opacity(configuration.isPressed ? 0.08 : 0)) }
                    else { Capsule().fill(.black.opacity(configuration.isPressed ? 0.08 : 0)) }
                }
                .allowsHitTesting(false)
            }
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

/// Native, multiline composer shared by chat and photo discussions. The host owns focus/drafts/commands.
public struct DIPMessageComposer: View {
    public enum Style { case standard, photoOverlay }
    @Binding private var text: String
    @FocusState private var isFocused: Bool
    private let placeholder: String
    private let isSending: Bool
    private let errorMessage: String?
    private let identifierPrefix: String
    private let style: Style
    private let avatar: AnyView?
    private let sendIcon: AnyView
    private let onSend: () -> Void
    private let onFocusChange: (Bool) -> Void
    public static let maximumLength = 2_000

    public init(
        text: Binding<String>, placeholder: String, isSending: Bool = false,
        errorMessage: String? = nil, identifierPrefix: String, onSend: @escaping () -> Void,
        onFocusChange: @escaping (Bool) -> Void = { _ in }
    ) {
        _text = text; self.placeholder = placeholder; self.isSending = isSending
        self.errorMessage = errorMessage; self.identifierPrefix = identifierPrefix
        self.style = .standard; self.avatar = nil
        self.sendIcon = AnyView(Image(systemName: "arrow.up").font(.system(size: 20, weight: .semibold)))
        self.onSend = onSend; self.onFocusChange = onFocusChange
    }

    public init<Avatar: View, SendIcon: View>(
        text: Binding<String>, placeholder: String, isSending: Bool = false,
        errorMessage: String? = nil, identifierPrefix: String, style: Style = .photoOverlay,
        avatar: () -> Avatar, sendIcon: () -> SendIcon, onSend: @escaping () -> Void,
        onFocusChange: @escaping (Bool) -> Void = { _ in }
    ) {
        _text = text; self.placeholder = placeholder; self.isSending = isSending
        self.errorMessage = errorMessage; self.identifierPrefix = identifierPrefix; self.style = style
        self.avatar = AnyView(avatar()); self.sendIcon = AnyView(sendIcon()); self.onSend = onSend; self.onFocusChange = onFocusChange
    }

    private var canSend: Bool {
        !isSending && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && text.count <= Self.maximumLength
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let errorMessage {
                VStack(alignment: .leading, spacing: 6) {
                    Label(errorMessage, systemImage: "exclamationmark.circle")
                        .font(.footnote).foregroundStyle(.red)
                        .accessibilityIdentifier(identifierPrefix + ".error")
                    Button("Try Again", action: onSend)
                        .font(.footnote.weight(.semibold))
                        .disabled(!canSend)
                        .accessibilityIdentifier(identifierPrefix + ".retry")
                }
                .padding(style == .photoOverlay ? 12 : 0)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(style == .photoOverlay ? Color.white : .clear,
                            in: RoundedRectangle(cornerRadius: 16))
            }
            HStack(alignment: .bottom, spacing: style == .photoOverlay ? -7 : 10) {
                HStack(spacing: avatar == nil ? 0 : 17) {
                    if let avatar { avatar.frame(width: 40, height: 40).clipShape(Circle()).accessibilityHidden(true) }
                    TextField(placeholder, text: $text, axis: .vertical)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                        .lineLimit(1...4)
                        .focused($isFocused)
                        .onChange(of: isFocused) { _, focused in onFocusChange(focused) }
                        .submitLabel(.send)
                        .onSubmit { if canSend { onSend() } }
                        .accessibilityLabel(placeholder)
                        .accessibilityIdentifier(identifierPrefix + ".message")
                        .padding(.trailing, style == .photoOverlay ? 14 : 0)
                }
                .padding(.leading, avatar == nil ? 16 : 5)
                .padding(.trailing, style == .photoOverlay ? 0 : 16)
                .padding(.vertical, avatar == nil ? 14 : 5)
                .frame(minHeight: 50)
                .background(style == .photoOverlay ? Color.white : DIPTokens.Color.surfaceMuted.swiftUIColor,
                            in: RoundedRectangle(cornerRadius: 25))
                Button(action: onSend) {
                    Group {
                        if isSending {
                            ProgressView().tint(style == .photoOverlay ? DIPTokens.Color.actionPrimary.swiftUIColor : .white)
                        }
                        else { sendIcon.frame(width: 20, height: 20) }
                    }
                    .foregroundStyle(style == .photoOverlay
                        ? DIPTokens.Color.actionPrimary.swiftUIColor.opacity(canSend || isSending ? 1 : 0.45)
                        : Color.white)
                    .frame(width: 50, height: 50)
                    .background(style == .photoOverlay ? Color.white
                        : DIPTokens.Color.actionPrimary.swiftUIColor.opacity(canSend || isSending ? 1 : 0.4),
                                in: Circle())
                    .contentShape(Circle())
                }
                .buttonStyle(DIPPressFeedbackStyle())
                .disabled(!canSend)
                .accessibilityLabel("Send")
                .accessibilityValue(isSending ? "Sending" : (canSend ? "" : "Enter a message within the character limit"))
                .accessibilityIdentifier(identifierPrefix + ".send")
            }
            if text.count > Self.maximumLength - 200 {
                Text("\(text.count)/\(Self.maximumLength)")
                    .font(.caption).foregroundStyle(text.count > Self.maximumLength ? .red : .secondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .accessibilityIdentifier(identifierPrefix + ".length")
            }
        }
    }
}

/// Value-only message presentation; repository identities and SDK types remain outside the library.
public struct DIPConversationBubble: View {
    private let showsAuthor: Bool
    private let showsTimestamp: Bool
    private let showsAvatar: Bool
    private let authorName: String
    private let text: String
    private let timestamp: Date
    private let isOwn: Bool
    private let avatar: AnyView
    public init<Avatar: View>(
        authorName: String, text: String, timestamp: Date, isOwn: Bool, showsAuthor: Bool = true, showsTimestamp: Bool = true, showsAvatar: Bool = true, avatar: () -> Avatar
    ) {
        self.showsAuthor = showsAuthor; self.showsTimestamp = showsTimestamp; self.showsAvatar = showsAvatar
        self.authorName = authorName; self.text = text; self.timestamp = timestamp
        self.isOwn = isOwn; self.avatar = AnyView(avatar())
    }
    public var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isOwn { Spacer(minLength: 36) }
            else {
                Group {
                    if showsAvatar { avatar.clipShape(Circle()) }
                    else { Color.clear }
                }
                .frame(width: 32, height: 32).accessibilityHidden(true)
            }
            VStack(alignment: isOwn ? .trailing : .leading, spacing: 5) {
                if showsAuthor {
                    Text(isOwn ? "You" : authorName)
                        .font(DIPReferenceAssets.font("Figtree-Bold", size: 13))
                        .accessibilityHidden(true)
                }
                Text(text)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                    .padding(.horizontal, 15).padding(.vertical, 12)
                    .background(isOwn ? DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.16)
                                      : DIPTokens.Color.surfaceMuted.swiftUIColor,
                                in: RoundedRectangle(cornerRadius: 20))
                    .textSelection(.enabled)
                if showsTimestamp {
                    Text(timestamp, style: .time).font(.caption2).foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
            }
            if !isOwn { Spacer(minLength: 36) }
        }
        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
        .accessibilityElement(children: .combine)
        .accessibilityValue("\(isOwn ? "You" : authorName), \(timestamp.formatted(date: .abbreviated, time: .shortened))")
    }
}

public struct DIPPhotoAttributionTag: View {
    private let name: String
    private let avatar: AnyView
    public init<Avatar: View>(name: String, avatar: () -> Avatar) {
        self.name = name; self.avatar = AnyView(avatar())
    }
    public var body: some View {
        HStack(spacing: 13.4) {
            avatar.frame(width: 36.667, height: 36.667).clipShape(Circle()).accessibilityHidden(true)
            Text(name).font(DIPReferenceAssets.font("Figtree-Regular", size: 18)).lineLimit(1)
        }
        .foregroundStyle(.black)
        .padding(.leading, 8.333).padding(.trailing, 16.667)
        .frame(minHeight: 50).background(.white, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}
#endif
