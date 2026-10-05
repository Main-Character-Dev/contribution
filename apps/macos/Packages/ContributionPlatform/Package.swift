// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ContributionPlatform",
    platforms: [.macOS(.v14)],
    products: [.library(name: "ContributionPlatform", targets: ["ContributionPlatform"])],
    targets: [
        .target(name: "ContributionPlatform"),
        .testTarget(name: "ContributionPlatformTests", dependencies: ["ContributionPlatform"])
    ],
    swiftLanguageModes: [.v6]
)
