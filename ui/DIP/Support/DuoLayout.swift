import Observation
import SwiftUI
import UIKit

/// Pure layout rule for the iPhone Duo. Only a device whose window scene provides hinge updates (`UIHinge`, iOS 27.1+) is
/// treated as a Duo; every other iPhone and iPad gets zero insets, so their layout is untouched.
///
/// The Duo reports its sensor island as a full-height side safe area (84 pt on the trailing edge in portrait; it mirrors
/// in landscape). The prototype screens ignore safe areas and draw edge to edge, so on a Duo the app is hosted in a
/// column that starts and ends inside that safe area. The folded outer display (and any Duo window narrower than
/// `openMinWidth`) keeps a phone column centred at no more than `maxColumnWidth`. The unfolded inner display (landscape,
/// 951x669 pt, 867 pt free beside the island) is the `open` posture: the column spans the whole free width and the app
/// switches to its bespoke wide layout (`DIPDuoShell`). Nothing is ever placed across the hinge.
struct DIPDuoLayout: Equatable {
    static let maxColumnWidth: CGFloat = 430
    /// Free width from which the Duo is treated as the open (inner display) posture.
    static let openMinWidth: CGFloat = 760
    static let none = DIPDuoLayout(leading: 0, trailing: 0)

    /// Width below which an already open posture closes. Slightly under `openMinWidth` so a width hovering at the
    /// threshold during a fold or rotation does not flap between the phone and the open shell.
    static let closeBelowWidth: CGFloat = 740

    /// True when a column `width` wide is the open posture on a hinge device. Regular phones and iPad never are.
    /// `wasOpen` applies hysteresis: an open posture stays open down to `closeBelowWidth`.
    static func isOpen(hingeAvailable: Bool, width: CGFloat, wasOpen: Bool = false) -> Bool {
        guard hingeAvailable else { return false }
        return wasOpen ? width >= closeBelowWidth : width >= openMinWidth
    }

    /// Hinge availability never goes back to false once a hinge was seen: a transient `nil` update (fold, rotation,
    /// scene change) must not swap the hosting subtree and drop all view state.
    static func latchedHinge(seen: Bool, update: Bool) -> Bool { seen || update }

    var leading: CGFloat
    var trailing: CGFloat

    static func resolve(
        hingeAvailable: Bool, safeLeading: CGFloat, safeTrailing: CGFloat, containerWidth: CGFloat
    ) -> DIPDuoLayout {
        guard hingeAvailable else { return .none }
        let leading = max(0, safeLeading), trailing = max(0, safeTrailing)
        let free = containerWidth - leading - trailing
        let extra = free > maxColumnWidth && free < openMinWidth ? (free - maxColumnWidth) / 2 : 0
        return DIPDuoLayout(leading: leading + extra, trailing: trailing + extra)
    }
}

/// The Duo's sensor column on the open inner display: the full-height side safe area that holds the system status
/// pill (wifi, clock, Control Center). The app's navigation rail lives in this column, below the pill, so the content
/// panes can start at the opposite edge. The side comes from the safe-area inset that is non-zero (so it follows a 180
/// degree rotation), never from a hardcoded edge.
struct DIPDuoSensor: Equatable {
    /// True when the column is on the physical right of the window.
    var onTrailing: Bool
    var width: CGFloat

    /// Height the status pill occupies at the top of the column (about 100 pt on the 951x669 inner display, plus margin). UIKit exposes only the side inset,
    /// not the pill, so this is a measured constant: the rail starts below it and nothing is drawn under the pill.
    static let pillClearance: CGFloat = 120

    /// The sensor column implied by the safe-area insets: the larger side inset. Nil when neither side has an inset.
    static func resolve(safeLeading: CGFloat, safeTrailing: CGFloat) -> DIPDuoSensor? {
        let leading = max(0, safeLeading), trailing = max(0, safeTrailing)
        guard max(leading, trailing) > 0 else { return nil }
        return DIPDuoSensor(onTrailing: trailing >= leading, width: max(leading, trailing))
    }
}

private struct DIPDuoOpenKey: EnvironmentKey { static let defaultValue = false }
private struct DIPDuoSensorKey: EnvironmentKey { static let defaultValue: DIPDuoSensor? = nil }
private struct DIPDuoRailSlotKey: EnvironmentKey { static let defaultValue: DIPDuoRailSlot? = nil }

/// Where the shell hands its navigation rail to the Duo window: the rail is drawn by a second hosting controller that
/// sits in the sensor column, because SwiftUI cannot draw outside the column the content host is limited to.
@MainActor @Observable final class DIPDuoRailSlot {
    var rail: AnyView?
}

private struct DIPDuoRailHostView: View {
    let slot: DIPDuoRailSlot
    var body: some View {
        Group { if let rail = slot.rail { rail } }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .preferredColorScheme(.light)
    }
}

extension EnvironmentValues {
    /// True only on a hinge device whose window is the open inner display. False on every regular iPhone and iPad.
    var dipDuoOpen: Bool {
        get { self[DIPDuoOpenKey.self] }
        set { self[DIPDuoOpenKey.self] = newValue }
    }
}

extension EnvironmentValues {
    /// The sensor column of the open inner display; nil on every other device and posture.
    var dipDuoSensor: DIPDuoSensor? {
        get { self[DIPDuoSensorKey.self] }
        set { self[DIPDuoSensorKey.self] = newValue }
    }
    /// Where the open Duo shell publishes its rail (see `DIPDuoRailSlot`); nil elsewhere.
    var dipDuoRailSlot: DIPDuoRailSlot? {
        get { self[DIPDuoRailSlotKey.self] }
        set { self[DIPDuoRailSlotKey.self] = newValue }
    }
}

/// Learns whether the window's hierarchy provides hinge updates. Regular iPhones deliver `hinge == nil`.
@MainActor @Observable final class DIPHingeObserver {
    /// Process-wide latch: once any window reported a hinge, later observers start with it (no identity swap).
    private static var seenHinge = false
    private(set) var hingeAvailable = DIPHingeObserver.seenHinge
    @ObservationIgnored private var interaction: AnyObject?

    /// Returns true once the interaction is installed, or when the OS has no hinge API (nothing to wait for).
    @discardableResult func attachIfNeeded() -> Bool {
        guard #available(iOS 27.1, *) else { return true }
        if interaction != nil { return true }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let window = (scenes.first { $0.activationState == .foregroundActive } ?? scenes.first)?.windows.first else { return false }
        let hinge = UIHingeInteraction { [weak self] _, update in
            let present = update.hinge != nil
            MainActor.assumeIsolated {
                let latched = DIPDuoLayout.latchedHinge(seen: DIPHingeObserver.seenHinge, update: present)
                DIPHingeObserver.seenHinge = latched
                if self?.hingeAvailable != latched { self?.hingeAvailable = latched }
            }
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

    func makeUIViewController(context: Context) -> DIPDuoColumnController<Content> { DIPDuoColumnController(content: content) }
    func updateUIViewController(_ controller: DIPDuoColumnController<Content>, context: Context) {
        controller.content = content
        controller.applyRoot()
    }
}

/// Holds the rail's hosting view and lets no touch through while the app presents a sheet, so the rail (which sits
/// beside the presenting content, not under the sheet) cannot switch tabs behind a modal.
private final class DIPDuoRailContainer: UIView {
    var isBlocked: () -> Bool = { false }
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        isBlocked() ? nil : super.hitTest(point, with: event)
    }
}

private final class DIPDuoColumnController<Content: View>: UIViewController {
    let host: UIHostingController<AnyView>
    var content: Content
    private var isOpen = false
    private var sensor: DIPDuoSensor?
    private let railSlot = DIPDuoRailSlot()
    private let railHost: UIHostingController<DIPDuoRailHostView>
    private let railContainer = DIPDuoRailContainer()

    init(content: Content) {
        self.content = content
        host = UIHostingController(rootView: AnyView(content.environment(\.dipDuoOpen, false)))
        railHost = UIHostingController(rootView: DIPDuoRailHostView(slot: railSlot))
        super.init(nibName: nil, bundle: nil)
    }

    /// Re-renders the content with the posture the last layout pass found (open reads `\.dipDuoOpen` in the shell). On the
    /// open display the content also learns the sensor column and where to publish its rail.
    func applyRoot() {
        guard isOpen, let sensor else { host.rootView = AnyView(content.environment(\.dipDuoOpen, isOpen)); return }
        host.rootView = AnyView(
            content.environment(\.dipDuoOpen, true).environment(\.dipDuoSensor, sensor)
                .environment(\.dipDuoRailSlot, railSlot))
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        host.view.backgroundColor = .clear
        // The app is light only (screens also set `.preferredColorScheme(.light)`); keep UIKit chrome in step.
        overrideUserInterfaceStyle = .light
        host.overrideUserInterfaceStyle = .light
        addChild(host)
        view.addSubview(host.view)
        host.didMove(toParent: self)
        railHost.view.backgroundColor = .clear
        railHost.overrideUserInterfaceStyle = .light
        // The rail column is the sensor safe area itself; the rail positions itself from the top of the window.
        railHost.safeAreaRegions = []
        railContainer.isHidden = true
        railContainer.isBlocked = { [weak self] in self?.host.presentedViewController != nil }
        railHost.view.frame = railContainer.bounds
        railHost.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        railContainer.addSubview(railHost.view)
        addChild(railHost)
        view.addSubview(railContainer)
        railHost.didMove(toParent: self)
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
        let width = max(0, view.bounds.width - layout.leading - layout.trailing)
        host.view.frame = CGRect(x: layout.leading, y: 0, width: width, height: view.bounds.height)
        let open = DIPDuoLayout.isOpen(hingeAvailable: true, width: width, wasOpen: isOpen)
        // The rail lives in the sensor column, on whichever side the safe area reports (it follows a 180 degree turn).
        let newSensor = open ? DIPDuoSensor.resolve(safeLeading: insets.left, safeTrailing: insets.right) : nil
        if let newSensor {
            let x = newSensor.onTrailing ? view.bounds.width - newSensor.width : 0
            railContainer.frame = CGRect(x: x, y: 0, width: newSensor.width, height: view.bounds.height)
        }
        railContainer.isHidden = newSensor == nil
        if open != isOpen || newSensor != sensor { isOpen = open; sensor = newSensor; applyRoot() }
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
