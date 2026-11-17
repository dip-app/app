import Observation
import SwiftUI
import UIKit

/// Pure layout rule for the iPhone Duo. Only a device whose window scene provides hinge updates (`UIHinge`, iOS 27.1+) is
/// treated as a Duo; every other iPhone and iPad gets zero insets, so their layout is untouched.
///
/// The Duo reports its sensor island as a full-height side safe area (84 pt on the trailing edge in portrait; it mirrors
/// in landscape). The prototype screens ignore safe areas and draw edge to edge, so on a Duo the app is hosted in a
/// column that starts and ends inside that safe area and, when the free width exceeds a phone (open posture), is centred
/// at no more than `maxColumnWidth`. Nothing is ever placed across the hinge.
struct DIPDuoLayout: Equatable {
    static let maxColumnWidth: CGFloat = 430
    static let none = DIPDuoLayout(leading: 0, trailing: 0)

    var leading: CGFloat
    var trailing: CGFloat

    static func resolve(
        hingeAvailable: Bool, safeLeading: CGFloat, safeTrailing: CGFloat, containerWidth: CGFloat
    ) -> DIPDuoLayout {
        guard hingeAvailable else { return .none }
        let leading = max(0, safeLeading), trailing = max(0, safeTrailing)
        let free = containerWidth - leading - trailing
        let extra = free > maxColumnWidth ? (free - maxColumnWidth) / 2 : 0
        return DIPDuoLayout(leading: leading + extra, trailing: trailing + extra)
    }
}

/// Learns whether the window's hierarchy provides hinge updates. Regular iPhones deliver `hinge == nil`.
@MainActor @Observable final class DIPHingeObserver {
    private(set) var hingeAvailable = false
    @ObservationIgnored private var interaction: AnyObject?

    /// Returns true once the interaction is installed, or when the OS has no hinge API (nothing to wait for).
    @discardableResult func attachIfNeeded() -> Bool {
        guard #available(iOS 27.1, *) else { return true }
        if interaction != nil { return true }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let window = (scenes.first { $0.activationState == .foregroundActive } ?? scenes.first)?.windows.first else { return false }
        let hinge = UIHingeInteraction { [weak self] _, update in
            let present = update.hinge != nil
            MainActor.assumeIsolated { if self?.hingeAvailable != present { self?.hingeAvailable = present } }
        }
        window.addInteraction(hinge)
        interaction = hinge
        return true
    }
}

/// Hosts `content` in a child hosting controller whose frame is the Duo layout. A separate hosting view is needed because
/// SwiftUI's `ignoresSafeArea` inside the app would otherwise expand back under the island whatever the parent pads.
private struct DIPDuoColumn<Content: View>: UIViewControllerRepresentable {
    let content: Content

    func makeUIViewController(context: Context) -> DIPDuoColumnController<Content> { DIPDuoColumnController(rootView: content) }
    func updateUIViewController(_ controller: DIPDuoColumnController<Content>, context: Context) { controller.host.rootView = content }
}

private final class DIPDuoColumnController<Content: View>: UIViewController {
    let host: UIHostingController<Content>

    init(rootView: Content) {
        host = UIHostingController(rootView: rootView)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        host.view.backgroundColor = .clear
        addChild(host)
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        view.setNeedsLayout()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let insets = view.safeAreaInsets
        let layout = DIPDuoLayout.resolve(
            hingeAvailable: true, safeLeading: insets.left, safeTrailing: insets.right, containerWidth: view.bounds.width)
        host.view.frame = CGRect(
            x: layout.leading, y: 0, width: max(0, view.bounds.width - layout.leading - layout.trailing), height: view.bounds.height)
    }
}

private struct DIPDuoLayoutModifier: ViewModifier {
    @State private var hinge = DIPHingeObserver()

    func body(content: Content) -> some View {
        Group {
            if hinge.hingeAvailable {
                DIPDuoColumn(content: content).ignoresSafeArea()
            } else {
                content
            }
        }
        .task {
            // The window can be missing on the first pass; retry briefly instead of leaving the Duo unhandled.
            for _ in 0..<40 where !hinge.attachIfNeeded() { try? await Task.sleep(for: .milliseconds(250)) }
        }
    }
}

extension View {
    /// Keeps content out of the iPhone Duo's sensor island and off the hinge; a no-op on every other device.
    func dipDuoLayout() -> some View { modifier(DIPDuoLayoutModifier()) }
}
