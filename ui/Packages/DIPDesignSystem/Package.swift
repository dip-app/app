// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DIPDesignSystem",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "DIPDesignSystem", targets: ["DIPDesignSystem"])],
    targets: [
        .target(name: "DIPDesignSystem", resources: [.process("Resources")]),
        .testTarget(name: "DIPDesignSystemTests", dependencies: ["DIPDesignSystem"])
    ]
)
