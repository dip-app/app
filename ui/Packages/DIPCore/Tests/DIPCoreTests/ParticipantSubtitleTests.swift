import DIPCore
import XCTest

final class ParticipantSubtitleTests: XCTestCase {
    private func person(job: String = "", dept: String = "") -> DIPParticipant {
        .init(id: "u", name: "Alex", department: dept, avatar: .asset("AvatarTeal"), jobTitle: job)
    }

    func testSubtitleShowsOnlyThePartsThatExist() {
        XCTAssertEqual(person(job: "Software Engineer (Part-Time)", dept: "Engineering").subtitle,
                       "Software Engineer (Part-Time) · Engineering")
        XCTAssertEqual(person(job: "Designer").subtitle, "Designer")
        XCTAssertEqual(person(dept: "HR").subtitle, "HR")
        XCTAssertEqual(person().subtitle, "")
        XCTAssertEqual(person(job: "  ", dept: " HR ").subtitle, "HR")
    }
}
