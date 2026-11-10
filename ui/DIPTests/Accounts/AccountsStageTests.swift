import DIPAccounts
import DIPContracts
import SwiftUI
import XCTest
@testable import DIP

/// The pure route → Stage mapping behind `AccountsStageView` (onboarding spec A0–A4).
final class AccountsStageTests: XCTestCase {
    private func scene(_ route: AccountsRoute, submitting: Bool = false, look: PendingLook = .cold) -> AccountsStageScene {
        guard let scene = AccountsStageScene.make(route: route, isSubmitting: submitting, pendingLook: look) else {
            XCTFail("\(route) has no stage scene"); return AccountsStageScene.make(route: .welcome)!
        }
        return scene
    }

    private let blockedFailures: [AccountsFailure] = [.personalEmailDomain, .membershipConflict, .permissionDenied]
    private let problemFailures: [AccountsFailure] = [.notConfigured, .rateLimited, .invalidProfile, .unknown,
                                                      .cancelled, .invalidInput, .unauthenticated]

    // MARK: Routes

    func testMemberHasNoStage() throws {
        let profile = AppUser(id: "u1", companyId: "c", displayName: "Pat", email: "p@example.invalid", photoURL: "",
                              avatarId: "", department: "", jobTitle: "", city: "", role: "member", interestTagIds: [],
                              travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [],
                              pointsBalance: 0, createdAt: Date(timeIntervalSince1970: 0))
        XCTAssertNil(AccountsStageScene.make(route: .member(try MembershipContext(uid: "u1", profile: profile))))
    }

    func testPendingAndResolvingLookDifferentButShareThePinkStage() {
        let pending = scene(.pending), resolving = scene(.resolving)
        XCTAssertNotEqual(pending, resolving)
        XCTAssertEqual(pending.tone.fill, .challenge)
        XCTAssertEqual(resolving.tone.fill, .challenge)
        XCTAssertEqual(pending.bar.title, "Just a moment…")
        XCTAssertEqual(resolving.bar.title, "Finding your company…")
        for progress in [pending, resolving] {
            XCTAssertTrue(progress.bar.showsProgress)
            XCTAssertEqual(progress.bar.identifier, "onboarding.progress")
            XCTAssertFalse(progress.barEnabled)
            XCTAssertEqual(progress.barIntent, .none)
            XCTAssertNil(progress.secondary)
        }
    }

    func testColdPendingIsTheStageAlone() {
        let cold = scene(.pending)
        XCTAssertEqual(cold.formation, .empty)
        XCTAssertTrue(cold.formation.slots.allSatisfy { !$0.isShown })
        XCTAssertNil(cold.copy)
        XCTAssertNil(cold.pill)
        XCTAssertNil(cold.footnote)
        XCTAssertFalse(cold.isSearching)
    }

    func testRetryLookIsTheSearchSoPendingToResolvingOnlyChangesTheBarTitle() {
        let retry = scene(.pending, look: .retry), resolving = scene(.resolving)
        XCTAssertEqual(retry.formation, resolving.formation)
        XCTAssertEqual(retry.pill, .looking)
        XCTAssertEqual(retry.copy, resolving.copy)
        XCTAssertEqual(retry.footnote, resolving.footnote)
        XCTAssertTrue(retry.isSearching)
        XCTAssertNotEqual(retry.bar.title, resolving.bar.title)
        var sameBar = retry
        sameBar.bar = resolving.bar
        XCTAssertEqual(sameBar, resolving)
    }

    func testSigningOutKeepsTheWelcomeGroupWithoutCopy() {
        let leaving = scene(.pending, look: .signingOut)
        XCTAssertEqual(leaving.formation, .welcome)
        XCTAssertNil(leaving.copy)
        XCTAssertFalse(leaving.isSearching)
    }

    func testWelcomeOffersGoogleOnTheBarAndTheReel() {
        let welcome = scene(.welcome)
        XCTAssertEqual(welcome.tone, .welcome)
        XCTAssertEqual(welcome.formation, .welcome)
        XCTAssertEqual(welcome.pill, .reel)
        XCTAssertEqual(welcome.copy, .welcome(dimmed: false))
        XCTAssertEqual(welcome.copy?.title, "Meet your team outside work")
        XCTAssertEqual(welcome.copy?.body,
                       "Board games, cooking nights, hikes and more. See which coworkers are going and join in one tap.")
        XCTAssertEqual(welcome.footnote, "Use your work Google account. We find your company from your email.")
        XCTAssertEqual(welcome.bar.title, "Continue with Google")
        XCTAssertEqual(welcome.bar.identifier, "onboarding.google")
        XCTAssertFalse(welcome.bar.showsProgress)
        XCTAssertEqual(welcome.barIntent, .signIn)
        XCTAssertTrue(welcome.barEnabled)

        let connecting = scene(.welcome, submitting: true)
        XCTAssertEqual(connecting.bar.title, "Connecting…")
        XCTAssertEqual(connecting.bar.value, "In progress")
        XCTAssertFalse(connecting.barEnabled)
    }

    func testResolvingKeepsTheTitleAndDimsTheBody() {
        let resolving = scene(.resolving)
        XCTAssertEqual(resolving.copy?.key, scene(.welcome).copy?.key, "the title must stay on A1 → A2")
        XCTAssertEqual(resolving.copy?.isDimmed, true)
        XCTAssertEqual(resolving.pill, .looking)
        XCTAssertEqual(StagePill.lookingText, "Looking for your team…")
        XCTAssertTrue(resolving.isSearching)
    }

    // MARK: Notices

    func testToneColoursAndFormations() {
        for failure in blockedFailures {
            let blocked = scene(.noCompany(failure))
            XCTAssertEqual(blocked.tone, .blocked, "\(failure)")
            XCTAssertEqual(blocked.tone.fill, .accent)
            XCTAssertEqual(blocked.formation, .blocked)
        }
        let notFound = scene(.noCompany(.noCompanyForDomain))
        XCTAssertEqual(notFound.tone.fill, .notification)
        XCTAssertEqual(notFound.formation, .notFound)

        let offline = scene(.problem(.unavailable))
        XCTAssertEqual(offline.tone.fill, .muted)
        XCTAssertEqual(offline.formation, .offline)
        XCTAssertTrue(offline.formation.showsLink)

        for failure in problemFailures {
            let problem = scene(.problem(failure))
            XCTAssertEqual(problem.tone, .problem, "\(failure)")
            XCTAssertEqual(problem.tone.fill, .accent)
            XCTAssertEqual(problem.formation, .problem)
        }
    }

    func testNoNoticeSharesPinkWithTheSearch() {
        for route in blockedFailures.map(AccountsRoute.noCompany) + [.noCompany(.noCompanyForDomain)]
            + problemFailures.map(AccountsRoute.problem) + [.problem(.unavailable)] {
            XCTAssertNotEqual(scene(route).tone.fill, .challenge, "\(route)")
        }
    }

    func testFormationLeadsMatchTheSpec() {
        let blocked = CrewFormation.blocked
        XCTAssertEqual(blocked[.yellow].size, 120)
        XCTAssertEqual(blocked[.yellow].fill, .notification)
        XCTAssertEqual(blocked[.yellow].rig, .worried)
        XCTAssertEqual(blocked[.yellow].y, 112)
        for member in [CrewMember.purple, .white, .gray] {
            XCTAssertEqual(blocked[member].size, 88)
            XCTAssertEqual(blocked[member].opacity, 0.35)
            XCTAssertTrue(blocked[member].isShown)
            XCTAssertEqual(abs(blocked[member].x), abs(CrewFormation.groupX(member)) + 28, accuracy: 0.001)
        }

        let notFound = CrewFormation.notFound
        XCTAssertEqual(notFound[.white].fill, .accent)
        XCTAssertEqual(notFound[.white].member.figure, .pill)
        XCTAssertEqual(notFound[.white].rig, .calm)
        XCTAssertEqual(notFound.slots.filter(\.isShown).count, 1)

        let offline = CrewFormation.offline
        XCTAssertEqual(offline[.white].size, 120)
        XCTAssertEqual(offline[.gray].size, 64)
        XCTAssertEqual(offline[.purple].size, 64)
        XCTAssertLessThan(offline[.gray].x, 0)
        XCTAssertGreaterThan(offline[.purple].x, 0)
        XCTAssertFalse(offline[.yellow].isShown)

        let problem = CrewFormation.problem
        XCTAssertEqual(problem[.purple].fill, .challenge)
        XCTAssertEqual(problem[.purple].rig, .worried)
        XCTAssertEqual(problem.slots.filter(\.isShown).count, 1)
    }

    func testWelcomeGroupGeometry() {
        let welcome = CrewFormation.welcome
        XCTAssertEqual(welcome.slots.map(\.member), CrewMember.allCases)
        XCTAssertTrue(welcome.slots.allSatisfy { $0.size == 88 && $0.y == 136 })
        // 88 pt faces overlapping by 19, centred on the Stage.
        XCTAssertEqual(welcome[.white].x - welcome[.purple].x, 69, accuracy: 0.001)
        XCTAssertEqual(welcome[.purple].x + welcome[.gray].x, 0, accuracy: 0.001)
        XCTAssertEqual(welcome[.yellow].rig.eyeOpen, 1, "the square face rests open; its wink is a beat")
        XCTAssertEqual(CrewFormation.looking[.yellow].rig, .happy)
    }

    func testNoticeCopyAndBarComeFromTheNotice() {
        let routes: [AccountsRoute] = blockedFailures.map(AccountsRoute.noCompany) + [.noCompany(.noCompanyForDomain)]
            + problemFailures.map(AccountsRoute.problem) + [.problem(.unavailable)]
        for route in routes {
            let stage = scene(route)
            let notice: AccountsNotice = switch route {
            case .noCompany(let reason): .noCompany(reason)
            case .problem(let failure): .problem(failure)
            default: .problem(.unknown)
            }
            XCTAssertEqual(stage.notice, notice)
            XCTAssertEqual(stage.copy, .notice(title: notice.title, message: notice.message))
            XCTAssertEqual(stage.copy?.entrance, .drop)
            XCTAssertEqual(stage.bar.title, notice.primary.title)
            XCTAssertEqual(stage.bar.identifier, "onboarding.primary")
            XCTAssertEqual(stage.barIntent, .notice(notice.primary.action))
            XCTAssertEqual(stage.secondary?.title, notice.secondary?.title)
            XCTAssertEqual(stage.secondary?.intent, notice.secondary.map { .notice($0.action) })
            XCTAssertNil(stage.footnote)
            XCTAssertNil(stage.pill)
            XCTAssertFalse(stage.isSearching)
        }
    }

    func testSubmittingDisablesBothNoticeActionsAndShowsProgress() {
        let busy = scene(.noCompany(.noCompanyForDomain), submitting: true)
        XCTAssertTrue(busy.bar.showsProgress)
        XCTAssertFalse(busy.barEnabled)
        XCTAssertFalse(busy.secondaryEnabled)
        let idle = scene(.noCompany(.noCompanyForDomain))
        XCTAssertFalse(idle.bar.showsProgress)
        XCTAssertTrue(idle.barEnabled)
        XCTAssertTrue(idle.secondaryEnabled)
    }

    func testRetryPaths() {
        // A3 not-found "Try again" goes straight back to A2; A4 "Try again" restarts through the A0 retry look.
        XCTAssertEqual(scene(.noCompany(.noCompanyForDomain)).barIntent, .notice(.retryMembership))
        XCTAssertEqual(scene(.problem(.unavailable)).barIntent, .notice(.restart))
        XCTAssertEqual(PendingLook(after: .restart), .retry)
        XCTAssertEqual(PendingLook(after: .retryMembership), .retry)
        XCTAssertEqual(PendingLook(after: .signOut), .signingOut)
    }

    func testBlockedWarnsOncePerArrival() {
        let blocked = scene(.noCompany(.personalEmailDomain))
        XCTAssertTrue(AccountsStageScene.warnsOnArrival(blocked, previousNotice: nil))
        XCTAssertFalse(AccountsStageScene.warnsOnArrival(blocked, previousNotice: blocked.notice))
        XCTAssertFalse(AccountsStageScene.warnsOnArrival(scene(.noCompany(.noCompanyForDomain)), previousNotice: nil))
        XCTAssertFalse(AccountsStageScene.warnsOnArrival(scene(.problem(.unknown)), previousNotice: nil))
        XCTAssertFalse(AccountsStageScene.warnsOnArrival(scene(.welcome), previousNotice: nil))
    }

    func testEntranceCharacters() {
        XCTAssertEqual(StageCopy.welcome(dimmed: false).entrance, .rise)
        XCTAssertEqual(StageCopy.Entrance.rise.offset, -36)
        XCTAssertEqual(StageCopy.Entrance.drop.offset, -24)
        XCTAssertEqual(StageCopy.Entrance.drop.titleDelay, 0.32, accuracy: 0.001)
        XCTAssertEqual(StageCopy.Entrance.drop.bodyDelay, 0.12, accuracy: 0.001)
        XCTAssertEqual(StageCopy.Entrance.rise.bodyDelay, 0.09, accuracy: 0.001)
    }

    func testReelRestsOnItsFirstEntryAfterThreeCycles() {
        XCTAssertEqual(StagePill.entries.first, "Board game lunch")
        XCTAssertEqual(StagePill.entries.count, 5)
        let changes = StagePill.entries.count * StagePill.reelCycles
        XCTAssertEqual(changes % StagePill.entries.count, 0)
        XCTAssertEqual(Double(changes) * StagePill.reelInterval, 36, accuracy: 0.001)
    }

    // MARK: Motion (spec v3 settle-time definition)

    func testSettleTimesUseSwiftUISettlingDuration() {
        XCTAssertEqual(OnboardingMotion.stageSpec.settlingDuration, 0.94, accuracy: 0.05)
        XCTAssertEqual(OnboardingMotion.hopSpec.settlingDuration, 0.85, accuracy: 0.05)
        XCTAssertEqual(OnboardingMotion.dropSpec.settlingDuration, 0.73, accuracy: 0.05)
        XCTAssertEqual(OnboardingMotion.pillSpec.settlingDuration, 0.78, accuracy: 0.05)
        XCTAssertEqual(OnboardingMotion.crewEntranceSpec.settlingDuration, 0.92, accuracy: 0.05)
        XCTAssertEqual(OnboardingMotion.winkClose + OnboardingMotion.winkHold + OnboardingMotion.winkOpen, 0.58, accuracy: 1e-9)
        // The A3/A4 title drop starts at 0.32 s, after the formation starts re-composing at 0.10 s.
        XCTAssertGreaterThan(StageCopy.Entrance.drop.titleDelay, 0.1)
    }

    // MARK: Face rig

    func testMoodsMapToRigPresets() {
        XCTAssertEqual(FaceRig(.happy), FaceRig(smile: 1, eyeOpen: 1, gaze: 0))
        XCTAssertEqual(FaceRig(.calm), FaceRig(smile: 0, eyeOpen: 1, gaze: 0))
        XCTAssertEqual(FaceRig(.worried), FaceRig(smile: -0.6, eyeOpen: 1, gaze: 0))
        XCTAssertEqual(FaceRig(.wink), FaceRig(smile: 1, eyeOpen: 0, gaze: 0))
    }

    func testMouthCurveKeepsTheOriginalArt() {
        XCTAssertEqual(FaceFeatures.mouthCurve(smile: 1), 0.16, accuracy: 1e-9)
        XCTAssertEqual(FaceFeatures.mouthCurve(smile: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(FaceFeatures.mouthCurve(smile: -0.6), -0.12, accuracy: 1e-9)
    }

    func testWinkIsAContinuousStroke() {
        let c = CGPoint(x: 10, y: 10), eye: CGFloat = 9
        let (openA, openB) = FaceFeatures.rightEyeStroke(center: c, eye: eye, eyeOpen: 1)
        XCTAssertEqual(openA.x, 10, accuracy: 1e-6)
        XCTAssertEqual(openB.y - openA.y, eye, accuracy: 1e-6)            // vertical, length eye
        let (shutA, shutB) = FaceFeatures.rightEyeStroke(center: c, eye: eye, eyeOpen: 0)
        XCTAssertEqual(shutA.y, 10, accuracy: 1e-6)
        XCTAssertEqual(shutB.x - shutA.x, eye / 0.75, accuracy: 1e-6)    // horizontal, 1.33 eye
        let (halfA, halfB) = FaceFeatures.rightEyeStroke(center: c, eye: eye, eyeOpen: 0.5)
        XCTAssertEqual(halfB.x - halfA.x, halfB.y - halfA.y, accuracy: 1e-6) // 45°
        let halfLength = hypot(halfB.x - halfA.x, halfB.y - halfA.y) / 2
        XCTAssertEqual(halfLength / eye, 0.583, accuracy: 0.001)
    }

    func testRigAnimatableDataRoundTrips() {
        var features = FaceFeatures(rig: .worried)
        features.animatableData = .init(0.25, .init(0.5, -0.75))
        XCTAssertEqual(features.rig, FaceRig(smile: 0.25, eyeOpen: 0.5, gaze: -0.75))
        XCTAssertEqual(features.animatableData.first, 0.25)
        XCTAssertEqual(features.animatableData.second.second, -0.75)
    }

    func testGazeShiftsEyesAndMouth() {
        let rect = CGRect(x: 0, y: 0, width: 100, height: 100)
        let left = FaceFeatures(rig: FaceRig(smile: 0, gaze: -1)).path(in: rect).boundingRect
        let right = FaceFeatures(rig: FaceRig(smile: 0, gaze: 1)).path(in: rect).boundingRect
        XCTAssertEqual(right.minX - left.minX, 12, accuracy: 0.5)
    }
}
