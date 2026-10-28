// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "DIPContracts",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "DIPContracts", targets: ["DIPContracts"])],
    targets: [
        .target(name: "DIPContracts"),
        .testTarget(name: "DIPContractsTests", dependencies: ["DIPContracts"], resources: [.copy("Fixtures")])
    ]
)
