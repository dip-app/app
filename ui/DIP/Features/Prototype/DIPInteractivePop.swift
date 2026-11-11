import SwiftUI
import UIKit

/// The shell hides the system navigation bar and back button, which also switches off the
/// interactive swipe-from-the-left-edge back gesture. Re-enable it for every pushed screen of any
/// `NavigationStack`/`UINavigationController` while the stack has something to pop. Sheets and root
/// screens (Home and the other main tabs, which are not pushed) are unaffected: the gesture only
/// begins when more than one controller is on the stack.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1
    }

    /// Lets the edge swipe coexist with scroll views (carousels, lists) inside the pushed screen.
    public func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        gestureRecognizer === interactivePopGestureRecognizer
    }
}
