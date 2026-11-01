// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DIPCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "DIPCore", targets: ["DIPCore"]),
        .library(name: "DIPMockData", targets: ["DIPMockData"]),
        .library(name: "DIPPresentation", targets: ["DIPPresentation"])
    ],
    targets: [
        .target(name: "DIPCore"),
        .target(name: "DIPMockData", dependencies: ["DIPCore"]),
        .target(name: "DIPPresentation", dependencies: ["DIPCore"]),
        .testTarget(name: "DIPCoreTests", dependencies: ["DIPCore", "DIPMockData"]),
        .testTarget(name: "DIPPresentationTests", dependencies: ["DIPCore", "DIPPresentation", "DIPMockData"])
    ]
)
