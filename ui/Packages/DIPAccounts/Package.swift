// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "DIPAccounts", defaultLocalization: "en", platforms: [.iOS(.v17), .macOS(.v14)], products: [.library(name: "DIPAccounts", targets: ["DIPAccounts"])], dependencies: [.package(path: "../DIPContracts")], targets: [.target(name: "DIPAccounts", dependencies: ["DIPContracts"]), .testTarget(name: "DIPAccountsTests", dependencies: ["DIPAccounts"])])
