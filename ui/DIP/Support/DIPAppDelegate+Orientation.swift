import UIKit

// Kept out of DuoLayout.swift on purpose: the ComponentPreview target compiles DuoLayout.swift but not the app delegate.
/// The app's orientation set per window, so the Duo's outer display can be portrait only (`DIPDuoOrientation`). Returns
/// the Info.plist set on every other device, which is what UIKit used before this method existed.
extension DIPAppDelegate {
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        DIPDuoOrientation.supported(for: window)
    }
}
