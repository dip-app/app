import DIPDesignSystem
import SwiftUI
import UIKit

/// A native page container with programmatic horizontal transitions.
/// It keeps feature hosts alive without letting the page pan gesture steal event-card scrolling.
struct DIPSlidingPages: UIViewControllerRepresentable {
    let selection: DIPHomeTab
    let reduceMotion: Bool
    let content: (DIPHomeTab) -> AnyView
    private static let order: [DIPHomeTab] = [.home, .events, .profile]

    func makeCoordinator() -> Coordinator { Coordinator(configuration: self) }

    func makeUIViewController(context: Context) -> UIPageViewController {
        let controller = UIPageViewController(
            transitionStyle: .scroll, navigationOrientation: .horizontal,
            options: [.interPageSpacing: 0])
        controller.view.backgroundColor = .white
        // Selection belongs to the fixed bottom bar. Nested horizontal lists keep their gestures.
        for scroll in controller.view.subviews.compactMap({ $0 as? UIScrollView }) {
            scroll.isScrollEnabled = false
        }
        context.coordinator.display(in: controller, initial: true)
        return controller
    }

    func updateUIViewController(_ controller: UIPageViewController, context: Context) {
        context.coordinator.configuration = self
        context.coordinator.refreshContent()
        context.coordinator.display(in: controller)
    }

    @MainActor final class Coordinator {
        var configuration: DIPSlidingPages
        private var hosts: [DIPHomeTab: UIHostingController<AnyView>] = [:]
        private var displayed: DIPHomeTab?
        private var transitioning = false

        init(configuration: DIPSlidingPages) { self.configuration = configuration }

        func refreshContent() {
            for (tab, host) in hosts { host.rootView = configuration.content(tab) }
        }

        private func host(for tab: DIPHomeTab) -> UIHostingController<AnyView> {
            if let host = hosts[tab] { return host }
            let host = UIHostingController(rootView: configuration.content(tab))
            host.safeAreaRegions = []
            host.view.backgroundColor = .white
            hosts[tab] = host
            return host
        }

        func display(in controller: UIPageViewController, initial: Bool = false) {
            let next = configuration.selection
            guard displayed != next, !transitioning else { return }
            let target = host(for: next)
            let oldIndex = DIPSlidingPages.order.firstIndex(of: displayed ?? next) ?? 0
            let nextIndex = DIPSlidingPages.order.firstIndex(of: next) ?? 0
            let direction: UIPageViewController.NavigationDirection = nextIndex >= oldIndex ? .forward : .reverse
            displayed = next

            if initial {
                controller.setViewControllers([target], direction: direction, animated: false)
            } else if configuration.reduceMotion {
                UIView.transition(
                    with: controller.view, duration: DIPMotion.reducedMotionDuration,
                    options: [.transitionCrossDissolve, .allowAnimatedContent]) {
                    controller.setViewControllers([target], direction: direction, animated: false)
                }
            } else {
                transitioning = true
                controller.setViewControllers([target], direction: direction, animated: true) {
                    [weak self, weak controller] _ in
                    guard let self, let controller else { return }
                    self.transitioning = false
                    self.display(in: controller)
                }
            }
        }
    }
}
