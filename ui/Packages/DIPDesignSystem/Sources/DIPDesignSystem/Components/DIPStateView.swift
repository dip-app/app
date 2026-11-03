#if canImport(SwiftUI)
    import SwiftUI

    public struct DIPStateView: View {
        public enum State {
            case loading(message: String)
            case empty(title: String, message: String)
            case failure(title: String, message: String)
        }
        private let state: State
        private let retryTitle: String
        private let retry: (() -> Void)?
        public init(_ state: State, retryTitle: String = "Try again", retry: (() -> Void)? = nil) {
            self.state = state
            self.retryTitle = retryTitle
            self.retry = retry
        }
        public var body: some View {
            Group {
                switch state {
                case .loading(let message):
                    ProgressView { Text(message).multilineTextAlignment(.center) }
                        .frame(maxWidth: .infinity, minHeight: 100)
                case .empty(let title, let message):
                    ContentUnavailableView {
                        Label(title, systemImage: "calendar")
                    } description: {
                        Text(message)
                    }
                case .failure(let title, let message):
                    ContentUnavailableView {
                        Label(title, systemImage: "exclamationmark.circle")
                    } description: {
                        Text(message)
                    } actions: {
                        if let retry { DIPButton(retryTitle, emphasis: .secondary, action: retry) }
                    }
                }
            }.foregroundStyle(DIPComponentTheme.ink).tint(DIPComponentTheme.ink)
        }
    }
#endif
