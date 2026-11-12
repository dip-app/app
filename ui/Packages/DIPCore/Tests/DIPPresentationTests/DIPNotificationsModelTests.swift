import DIPCore
import DIPMockData
import DIPPresentation
import Foundation
import Testing

@MainActor @Suite struct DIPNotificationsModelTests {
    private func ready(_ repository: DIPMockNotificationsRepository) async -> (DIPNotificationsModel, Task<Void, Never>) {
        let model = DIPNotificationsModel(repository: repository)
        let task = Task { await model.observe() }
        for _ in 0..<100 where model.phase == .loading { try? await Task.sleep(for: .milliseconds(10)) }
        // The unread listener answers separately; give it a moment.
        try? await Task.sleep(for: .milliseconds(60))
        return (model, task)
    }

    @Test func loadsTheFirstPageAndCountsUnreadLive() async {
        let (model, task) = await ready(.reference())
        defer { task.cancel() }
        #expect(model.phase == .ready)
        #expect(model.items.count == 8)
        #expect(model.unreadCount == 4)
        #expect(model.sections().first?.group == .today)
    }

    @Test func openingARowMarksItReadOptimisticallyAndTheListenerConfirms() async {
        let repository = DIPMockNotificationsRepository.reference()
        let (model, task) = await ready(repository)
        defer { task.cancel() }
        await model.markRead("invite_e1_me")
        #expect(model.unreadCount == 3)
        #expect(model.items.first { $0.id == "invite_e1_me" }?.isRead == true)
        #expect(await repository.markedRead == ["invite_e1_me"])
        // Marking a read row does nothing.
        await model.markRead("reminder_e3")
        #expect(await repository.markedRead == ["invite_e1_me"])
    }

    @Test func markAllReadClearsEverythingAndAFailureRestoresTheBadge() async {
        let (model, task) = await ready(.reference())
        defer { task.cancel() }
        let done = await model.markAllRead()
        #expect(done)
        #expect(model.unreadCount == 0)
        #expect(!model.hasUnread)

        let (failing, failingTask) = await ready(.reference(behavior: .init(markFailure: .offline)))
        defer { failingTask.cancel() }
        #expect(await failing.markAllRead() == false)
        #expect(failing.unreadCount == 4)
        #expect(failing.markAllError != nil)
    }

    @Test func paginationLoadsOlderPagesUntilShort() async {
        let (model, task) = await ready(.reference(count: 70))
        defer { task.cancel() }
        #expect(model.items.count == 30)
        #expect(model.canLoadMore)
        await model.loadMore()
        #expect(model.items.count == 60)
        await model.loadMore()
        #expect(model.items.count == 70)
        #expect(!model.canLoadMore)
        #expect(Set(model.items.map(\.id)).count == 70)
    }

    @Test func aFailedPageKeepsWhatIsShownAndCanBeRetried() async {
        let (model, task) = await ready(.reference(count: 70, behavior: .init(loadOlderFailure: .offline)))
        defer { task.cancel() }
        await model.loadMore()
        #expect(model.items.count == 30)
        #expect(model.loadMoreError != nil)
        #expect(model.canLoadMore)
    }

    @Test func emptyAndFailedStates() async {
        let (empty, emptyTask) = await ready(.empty())
        defer { emptyTask.cancel() }
        for _ in 0..<50 where empty.phase == .loading { try? await Task.sleep(for: .milliseconds(10)) }
        #expect(empty.isEmpty)
        #expect(!empty.canLoadMore)

        let failing = DIPNotificationsModel(repository: DIPMockNotificationsRepository.reference(behavior: .init(observeFailure: true)))
        await failing.observe()
        #expect(failing.phase == .failed(DIPNotificationFailure.offline.message))
    }

    @Test func aNewServerNotificationArrivesLiveAndRaisesTheBadge() async {
        let repository = DIPMockNotificationsRepository.reference()
        let (model, task) = await ready(repository)
        defer { task.cancel() }
        await repository.deliver(DIPNotification(id: "new", kind: .invite, title: "New invitation", body: "", destination: .invitations,
                                                 createdAt: Date(), isRead: false))
        for _ in 0..<100 where model.unreadCount < 5 { try? await Task.sleep(for: .milliseconds(10)) }
        #expect(model.unreadCount == 5)
        #expect(model.items.first?.id == "new")
    }
}
