#if canImport(SwiftUI)
    import SwiftUI

    /// The bar's "work in flight" indicator, drawn in the trailing 64 pt white circle (owner revision, Nov 10:
    /// replaces the shimmer band and the dot pulse; the label stays calm). Three candidates are kept so the
    /// owner can compare them in the Preview app (`--progress-style=wheel|orbit|hop`); `wheel` ships.
    ///
    /// Every candidate uses the app-assigned avatar faces, springs from `DIPMotion`, and under Reduce Motion
    /// draws one calm face with no loop.
    public enum DIPProgressIndicatorStyle: String, CaseIterable, Sendable {
        /// A wheel of faces: the front face sits centred and large; every 0.55 s the wheel turns with
        /// `DIPMotion.marker` and the next face swings in and grows.
        case wheel
        /// One face in the centre with an `actionPrimary` arc orbiting it.
        case orbit
        /// Three small faces hop in turn with `DIPMotion.affordance`, like the Crew on Welcome.
        case hop

        public static let shipping = DIPProgressIndicatorStyle.wheel

        /// The faces the indicator cycles through: the avatars the app assigns to members.
        public static let faces = ["AvatarPink", "AvatarTeal", "AvatarRed"]
    }

    private struct DIPProgressIndicatorStyleKey: EnvironmentKey {
        static let defaultValue = DIPProgressIndicatorStyle.shipping
    }

    public extension EnvironmentValues {
        /// Which progress indicator bars draw. The app uses the default; previews may switch it.
        var dipProgressIndicatorStyle: DIPProgressIndicatorStyle {
            get { self[DIPProgressIndicatorStyleKey.self] }
            set { self[DIPProgressIndicatorStyleKey.self] = newValue }
        }
    }

    /// The indicator inside a 64 pt circle. `animated: false` (Reduce Motion) shows one still face.
    struct DIPProgressIndicator: View {
        let style: DIPProgressIndicatorStyle
        let animated: Bool

        var body: some View {
            Group {
                if !animated {
                    face(0, size: 40)
                } else {
                    switch style {
                    case .wheel: DIPProgressWheel()
                    case .orbit: DIPProgressOrbit()
                    case .hop: DIPProgressHop()
                    }
                }
            }
            .frame(width: 64, height: 64)
            .clipShape(Circle())
            .allowsHitTesting(false)
        }
    }

    fileprivate func face(_ index: Int, size: CGFloat) -> some View {
        let faces = DIPProgressIndicatorStyle.faces
        return DIPReferenceAssets.image(faces[((index % faces.count) + faces.count) % faces.count]).resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(Circle())
    }

    /// Faces on a turning wheel. The wheel holds four seats; seat 0 (front, centre) is large, the others sit
    /// small on a ring behind it. Each turn moves every face one seat on with a spring, so the next face swings
    /// to the front and grows.
    struct DIPProgressWheel: View {
        static let turn = 0.55
        static let seats = 4
        @State private var step = 0

        var body: some View {
            ZStack {
                ForEach(0..<Self.seats, id: \.self) { slot in
                    let seat = ((slot - step) % Self.seats + Self.seats) % Self.seats
                    let front = seat == 0
                    let angle = Angle.degrees(Double(seat) * 360 / Double(Self.seats) + 180)
                    face(slot, size: 40)
                        .scaleEffect(front ? 1 : 0.4)
                        .opacity(front ? 1 : 0.55)
                        .offset(x: front ? 0 : 21 * cos(angle.radians), y: front ? 0 : 21 * sin(angle.radians))
                        .zIndex(front ? 1 : 0)
                }
            }
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(Self.turn))
                    guard !Task.isCancelled else { return }
                    withAnimation(DIPMotion.marker) { step += 1 }
                }
            }
        }
    }

    /// A face with an accent arc orbiting it.
    struct DIPProgressOrbit: View {
        @State private var turning = false

        var body: some View {
            ZStack {
                face(0, size: 36)
                Circle()
                    .trim(from: 0, to: 0.28)
                    .stroke(DIPTokens.Color.actionPrimary.swiftUIColor, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .frame(width: 50, height: 50)
                    .rotationEffect(.degrees(turning ? 360 : 0))
                    .animation(.linear(duration: 1.1).repeatForever(autoreverses: false), value: turning)
            }
            .onAppear { turning = true }
        }
    }

    /// Three small faces hopping in turn.
    struct DIPProgressHop: View {
        @State private var beat = 0

        var body: some View {
            HStack(spacing: 2) {
                ForEach(0..<3, id: \.self) { index in
                    face(index, size: 18)
                        .offset(y: beat % 3 == index ? -6 : 0)
                        .scaleEffect(beat % 3 == index ? 1.12 : 1)
                }
            }
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(0.32))
                    guard !Task.isCancelled else { return }
                    withAnimation(DIPMotion.affordance()) { beat += 1 }
                }
            }
        }
    }
#endif
