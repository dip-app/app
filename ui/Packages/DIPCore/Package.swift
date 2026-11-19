// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DIPCore",
    defaultLocalization: "en",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "DIPCore", targets: ["DIPCore"]),
        .library(name: "DIPMockData", targets: ["DIPMockData"]),
        .library(name: "DIPPresentation", targets: ["DIPPresentation"])
    ],
    targets: [
        .target(name: "DIPCore", resources: [.process("Resources")]),
        .target(name: "DIPMockData", dependencies: ["DIPCore"], resources: [.process("Resources")]),
        .target(name: "DIPPresentation", dependencies: ["DIPCore"], resources: [.process("Resources")]),
        .testTarget(name: "DIPCoreTests", dependencies: ["DIPCore", "DIPMockData"]),
        .testTarget(name: "DIPPresentationTests", dependencies: ["DIPCore", "DIPPresentation", "DIPMockData"])
    ]
)
