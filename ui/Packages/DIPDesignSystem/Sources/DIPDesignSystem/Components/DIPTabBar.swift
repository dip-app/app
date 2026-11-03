#if canImport(SwiftUI)
    import SwiftUI

    /// Native TabView supplies safe-area handling and selected-tab accessibility.
    /// V1 has Home, My Events and Profile; rewards are intentionally absent.
    public struct DIPTabBar<Content: View>: View {
        @Binding private var selection: DIPDestination
        private let content: (DIPDestination) -> Content
        public init(selection: Binding<DIPDestination>, @ViewBuilder content: @escaping (DIPDestination) -> Content) {
            self._selection = selection
            self.content = content
        }
        public var body: some View {
            TabView(selection: $selection) {
                ForEach(DIPDestination.allCases) { destination in
                    content(destination)
                        .tabItem { Label(destination.title, systemImage: destination.systemImage) }
                        .tag(destination)
                }
            }.tint(DIPComponentTheme.ink)
        }
    }
#endif
