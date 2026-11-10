import XCTest

@testable import DIPDesignSystem

#if canImport(SwiftUI)
    import SwiftUI
#endif

final class DIPEmptyStateTests: XCTestCase {
    func testIdentifiersFollowEmptyScreenConvention() {
        let content = DIPEmptyStateContent(screen: "home-recents", title: "Events you’ve attended will show up here")
        XCTAssertEqual(content.identifier, "empty.home-recents")
        XCTAssertEqual(content.actionIdentifier, "empty.home-recents.action")
        XCTAssertEqual(DIPEmptyStateContent(screen: " My Events / Past ", title: "x").identifier, "empty.my-events-past")
        XCTAssertEqual(DIPEmptyStateContent(screen: "  ", title: "x").identifier, "empty.screen")
    }

    func testTitleAndMessageReadAsOneSentencePair() {
        let content = DIPEmptyStateContent(
            screen: "album", title: " No photos yet ", message: "Be the first to add one from this event.")
        XCTAssertEqual(content.title, "No photos yet")
        XCTAssertEqual(content.accessibilityLabel, "No photos yet. Be the first to add one from this event.")
        XCTAssertEqual(DIPEmptyStateContent(screen: "a", title: "Hi!").accessibilityLabel, "Hi!")
    }

    func testBlankMessageAndActionAreDropped() {
        let content = DIPEmptyStateContent(screen: "participants", title: "No one yet", message: "  ", actionTitle: "\n")
        XCTAssertNil(content.message)
        XCTAssertNil(content.actionTitle)
        XCTAssertEqual(content.accessibilityLabel, "No one yet.")
    }

    #if canImport(SwiftUI)
        @MainActor func testRendersEveryStyleFaceCountAndAccessibilityTextSize() {
            for style in [DIPEmptyState.Style.card, .compact] {
                for faces in [-1, 0, 2, 9] {
                    for size in [DynamicTypeSize.large, .accessibility5] {
                        let renderer = ImageRenderer(content: DIPEmptyState(
                            screen: "x", title: "Nothing planned yet", message: "Check back soon.", style: style,
                            faces: faces, actionTitle: "Browse past events", action: {}
                        ).frame(width: 362).environment(\.dynamicTypeSize, size))
                        let image = renderer.cgImage
                        XCTAssertNotNil(image)
                        XCTAssertGreaterThan(image?.height ?? 0, 0)
                    }
                }
            }
            XCTAssertEqual(DIPCrewFace.crew.count, 4)
        }
    #endif
}
