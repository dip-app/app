import Observation
import OSLog
import SwiftUI
import UIKit

/// Pure layout rule for the iPhone Duo. Only a device whose window scene provides hinge updates (`UIHinge`, iOS 27.1+) is
/// treated as a Duo; every other iPhone and iPad gets zero insets, so their layout is untouched.
///
/// The Duo reports its sensor island as a full-height side safe area (84 pt on the trailing edge in portrait; it mirrors
/// in landscape). The prototype screens ignore safe areas and draw edge to edge, so on a Duo the app is hosted in a
/// column that starts and ends inside that safe area. The folded outer display (and any Duo window narrower than
/// `openMinWidth`) keeps a phone column centred at no more than `maxColumnWidth`; the folded outer display is portrait
/// only (`DIPDuoOrientation`) and its tabs sit in the sensor-column rail like the inner display's. The unfolded inner display (landscape,
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

/// Which interface orientations a Duo window may use. The folded outer display is a portrait phone screen (466x678 pt)
/// and the phone layouts are portrait designs, but the app's default orientation set includes landscape, so a device
/// orientation carried over from the landscape inner display rotated the outer display's UI sideways (678x466, the phone
/// column laid out along the long edge). On a hinge device whose lit screen is the outer one, the app therefore asks for
/// portrait; the inner display and every regular iPhone keep the default set.
enum DIPDuoOrientation {
    /// The orientations a window may use: `defaultMask` unless this is a hinge device on its outer display (the hinge
    /// reports closed, or the screen's long side is shorter than the open layout needs), which is portrait only.
    static func supported(
        hingeAvailable: Bool, hingeClosed: Bool, screenLongSide: CGFloat, defaultMask: UIInterfaceOrientationMask
    ) -> UIInterfaceOrientationMask {
        guard hingeAvailable else { return defaultMask }
        return hingeClosed || screenLongSide < DIPDuoLayout.openMinWidth ? .portrait : defaultMask
    }

    /// The app's own orientation set (Info.plist), or UIKit's default when the plist names none: all but upside down on
    /// iPhone, all on iPad.
    static func infoPlistMask(_ info: [String: Any]? = Bundle.main.infoDictionary, idiom: UIUserInterfaceIdiom) -> UIInterfaceOrientationMask {
        let key = idiom == .pad ? "UISupportedInterfaceOrientations~ipad" : "UISupportedInterfaceOrientations~iphone"
        let names = (info?[key] ?? info?["UISupportedInterfaceOrientations"]) as? [String] ?? []
        let mask = names.reduce(into: UIInterfaceOrientationMask()) { mask, name in
            switch name {
            case "UIInterfaceOrientationPortrait": mask.insert(.portrait)
            case "UIInterfaceOrientationPortraitUpsideDown": mask.insert(.portraitUpsideDown)
            case "UIInterfaceOrientationLandscapeLeft": mask.insert(.landscapeLeft)
            case "UIInterfaceOrientationLandscapeRight": mask.insert(.landscapeRight)
            default: break
            }
        }
        if !mask.isEmpty { return mask }
        return idiom == .pad ? .all : .allButUpsideDown
    }

    /// The live decision for `window` (nil window: the app default).
    @MainActor static func supported(for window: UIWindow?) -> UIInterfaceOrientationMask {
        let defaultMask = infoPlistMask(idiom: UIDevice.current.userInterfaceIdiom)
        guard let window else { return defaultMask }
        let bounds = (window.windowScene?.screen ?? window.screen).bounds
        return supported(
            hingeAvailable: DIPHingeObserver.seenHingeAnywhere, hingeClosed: DIPHingeObserver.hingeClosed,
            screenLongSide: max(bounds.width, bounds.height), defaultMask: defaultMask)
    }

    /// Re-applies the decision to `scene` after a posture change: UIKit re-reads the supported set, and a window that is
    /// now outside it (landscape on the outer display) is asked to rotate to portrait.
    @MainActor static func apply(to scene: UIWindowScene) {
        let window = scene.windows.first
        let mask = supported(for: window)
        window?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        let current = scene.effectiveGeometry.interfaceOrientation
        if !mask.contains(UIInterfaceOrientationMask(orientation: current)) {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { error in
                DIPDuoProbe.log("geometry update refused: \(error.localizedDescription)")
            }
        }
        DIPDuoProbe.log(scene: scene, mask: mask)
    }
}

/// The app's orientation set per window, so the Duo's outer display can be portrait only (`DIPDuoOrientation`). Returns
/// the Info.plist set on every other device, which is what UIKit used before this method existed.
extension DIPAppDelegate {
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        DIPDuoOrientation.supported(for: window)
    }
}

extension UIInterfaceOrientationMask {
    init(orientation: UIInterfaceOrientation) {
        switch orientation {
        case .portrait: self = .portrait
        case .portraitUpsideDown: self = .portraitUpsideDown
        case .landscapeLeft: self = .landscapeLeft
        case .landscapeRight: self = .landscapeRight
        default: self = []
        }
    }
}

/// Debug-only trace of the Duo posture and geometry (Console: subsystem work.letsdip.app, category duo). Release builds
/// log nothing.
enum DIPDuoProbe {
    @MainActor static func log(scene: UIWindowScene, mask: UIInterfaceOrientationMask) {
        #if DEBUG
        let screen = scene.screen.bounds.size, window = scene.windows.first?.bounds.size ?? .zero
        let insets = scene.windows.first?.safeAreaInsets ?? .zero
        log("hinge=\(DIPHingeObserver.seenHingeAnywhere) closed=\(DIPHingeObserver.hingeClosed) "
            + "interface=\(scene.effectiveGeometry.interfaceOrientation.rawValue) device=\(UIDevice.current.orientation.rawValue) "
            + "screen=\(Int(screen.width))x\(Int(screen.height)) window=\(Int(window.width))x\(Int(window.height)) "
            + "safe=l\(Int(insets.left)) r\(Int(insets.right)) t\(Int(insets.top)) b\(Int(insets.bottom)) mask=\(mask.rawValue)")
        #endif
    }

    static func log(_ message: String) {
        #if DEBUG
        Logger(subsystem: "work.letsdip.app", category: "duo").notice("\(message, privacy: .public)")
        #endif
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
    /// Where the rail may start: below the status pill of the display this column belongs to.
    var topClearance: CGFloat = DIPDuoSensor.pillClearance
    /// The window's real top safe-area inset (0 on both Duo displays, whose status lives in the side column).
    var safeTop: CGFloat = 0

    /// Height the status pill occupies at the top of the column (about 100 pt on the 951x669 inner display, plus margin). UIKit exposes only the side inset,
    /// not the pill, so this is a measured constant: the rail starts below it and nothing is drawn under the pill.
    static let pillClearance: CGFloat = 120
    /// The same on the folded 466x678 outer display, where camera, clock and the wifi / Control Center pill stack down
    /// to about y 151 pt (measured on the Claude-Duo simulator), plus the same gap the inner rail keeps below its pill
    /// (about 22 pt, measured).
    static let outerPillClearance: CGFloat = 173

    /// The sensor column implied by the safe-area insets: the larger side inset. Nil when neither side has an inset.
    /// `open` picks the display: the unfolded inner one, or the folded outer one with its taller pill.
    static func resolve(safeLeading: CGFloat, safeTrailing: CGFloat, open: Bool = true, safeTop: CGFloat = 0) -> DIPDuoSensor? {
        let leading = max(0, safeLeading), trailing = max(0, safeTrailing)
        guard max(leading, trailing) > 0 else { return nil }
        return DIPDuoSensor(onTrailing: trailing >= leading, width: max(leading, trailing),
                            topClearance: open ? pillClearance : outerPillClearance, safeTop: max(0, safeTop))
    }
}

private struct DIPDuoOpenKey: EnvironmentKey { static let defaultValue = false }
private struct DIPDuoSensorKey: EnvironmentKey { static let defaultValue: DIPDuoSensor? = nil }
private struct DIPDuoRailSlotKey: EnvironmentKey { static let defaultValue: DIPDuoRailSlot? = nil }
private struct DIPDuoTabsInRailKey: EnvironmentKey { static let defaultValue = false }

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
    /// Where the Duo shell publishes its rail (see `DIPDuoRailSlot`); nil elsewhere.
    var dipDuoRailSlot: DIPDuoRailSlot? {
        get { self[DIPDuoRailSlotKey.self] }
        set { self[DIPDuoRailSlotKey.self] = newValue }
    }
    /// Top inset of page content for this display (`DIPDuoPaneLayout.topInset`): 60 pt on regular iPhones, the real
    /// top safe area plus 20 pt on a Duo display whose status lives in the sensor column.
    var dipTopInset: CGFloat { DIPDuoPaneLayout.topInset(open: dipDuoOpen, sensor: dipDuoSensor) }
    /// True on a Duo display with a sensor column (inner or folded outer): the tabs live in the rail there, so pages
    /// keep no room for the phone's floating tab bar. False on every regular iPhone and iPad.
    var dipDuoTabsInRail: Bool {
        get { self[DIPDuoTabsInRailKey.self] }
        set { self[DIPDuoTabsInRailKey.self] = newValue }
    }
}

/// Learns whether the window's hierarchy provides hinge updates. Regular iPhones deliver `hinge == nil`.
@MainActor @Observable final class DIPHingeObserver {
    /// Process-wide latch: once any window reported a hinge, later observers start with it (no identity swap).
    private static var seenHinge = false
    /// True while the hinge reports closed (the outer display is lit). Read by `DIPDuoOrientation`.
    private(set) static var hingeClosed = false
    static var seenHingeAnywhere: Bool { seenHinge }
    private(set) var hingeAvailable = DIPHingeObserver.seenHinge
    @ObservationIgnored private var interaction: AnyObject?

    /// Returns true once the interaction is installed, or when the OS has no hinge API (nothing to wait for).
    @discardableResult func attachIfNeeded() -> Bool {
        // UIHingeInteraction ships in the iOS 27.1 SDK (Swift 6.4+ toolchains); older SDKs (CI) have no hinge API.
        #if compiler(>=6.4)
        guard #available(iOS 27.1, *) else { return true }
        if interaction != nil { return true }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let window = (scenes.first { $0.activationState == .foregroundActive } ?? scenes.first)?.windows.first else { return false }
        let hinge = UIHingeInteraction { [weak self, weak window] _, update in
            let present = update.hinge != nil
            // A nil update (scene change) keeps the last known posture; only a reported hinge changes it.
            let closed = update.hinge.map { $0.status == .closed }
            MainActor.assumeIsolated {
                let latched = DIPDuoLayout.latchedHinge(seen: DIPHingeObserver.seenHinge, update: present)
                DIPHingeObserver.seenHinge = latched
                if let closed { DIPHingeObserver.hingeClosed = closed }
                if self?.hingeAvailable != latched { self?.hingeAvailable = latched }
                // The outer display is portrait; the inner one may rotate again (`DIPDuoOrientation`).
                if latched, let scene = window?.windowScene { DIPDuoOrientation.apply(to: scene) }
            }
        }
        window.addInteraction(hinge)
        interaction = hinge
        return true
        #else
            return true
        #endif
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
    private let railSlot: DIPDuoRailSlot
    /// The orientation set last handed to UIKit; re-applied when the lit screen changes after a fold.
    private var appliedMask: UIInterfaceOrientationMask?
    private let railHost: UIHostingController<DIPDuoRailHostView>
    private let railContainer = DIPDuoRailContainer()

    init(content: Content) {
        self.content = content
        let slot = DIPDuoRailSlot()
        railSlot = slot
        host = UIHostingController(rootView: Self.root(content, open: false, sensor: nil, slot: slot))
        railHost = UIHostingController(rootView: DIPDuoRailHostView(slot: slot))
        super.init(nibName: nil, bundle: nil)
    }

    /// Re-renders the content with the posture the last layout pass found (open reads `\.dipDuoOpen` in the shell). On the
    /// open display the content also learns the sensor column and where to publish its rail.
    /// Wherever the display has a sensor column (open inner display, or the folded outer one) the tabs move to the rail.
    func applyRoot() {
        host.rootView = Self.root(content, open: isOpen, sensor: sensor, slot: railSlot)
    }

    /// Always the same view type whatever the posture: `AnyView` resets all state below it when the wrapped type changes,
    /// so a fold or unfold must only change environment values, never the modifier chain.
    private static func root(_ content: Content, open: Bool, sensor: DIPDuoSensor?, slot: DIPDuoRailSlot) -> AnyView {
        AnyView(
            content.environment(\.dipDuoOpen, open).environment(\.dipDuoSensor, sensor)
                .environment(\.dipDuoRailSlot, sensor == nil ? nil : slot).environment(\.dipDuoTabsInRail, sensor != nil))
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
        // VoiceOver reads the page first, then the navigation rail (not top-to-bottom across the two columns).
        view.accessibilityElements = [host.view as Any, railContainer]
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
        // Folded, the outer display has the same column (taller pill); the inner display held upright has none.
        let newSensor = DIPDuoSensor.resolve(
            safeLeading: insets.left, safeTrailing: insets.right, open: open, safeTop: insets.top)
        if let newSensor {
            let x = newSensor.onTrailing ? view.bounds.width - newSensor.width : 0
            railContainer.frame = CGRect(x: x, y: 0, width: newSensor.width, height: view.bounds.height)
        }
        railContainer.isHidden = newSensor == nil
        if open != isOpen || newSensor != sensor { isOpen = open; sensor = newSensor; applyRoot() }
        // The hinge update can arrive before the window moves to the other display (screen bounds still the old one);
        // the next layout on the new display settles the orientation set.
        if let scene = view.window?.windowScene, DIPDuoOrientation.supported(for: view.window) != appliedMask {
            appliedMask = DIPDuoOrientation.supported(for: view.window)
            DispatchQueue.main.async { DIPDuoOrientation.apply(to: scene) }
        }
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
