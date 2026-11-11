import DIPDesignSystem
import Foundation

/// Mock-backed gift catalogue for the Rewards tab (V2-S03 stretch). There is no rewards contract,
/// backend or points ledger yet; nothing here is persisted or redeemable.
struct DIPReward: Identifiable, Equatable {
    let id: String
    let title: String
    let detail: String
    let cost: Int
    let style: DIPGiftStyle

    func isAffordable(balance: Int) -> Bool { balance >= cost }
    func pointsShort(balance: Int) -> Int { max(0, cost - balance) }
}

enum DIPRewardsMock {
    /// Stand-in balance: `DIPProfile` does not expose `pointsBalance` yet (the contract `AppUser` has it).
    static let balance = 520

    static let rewards: [DIPReward] = [
        DIPReward(id: "coffee", title: "Coffee Treat", detail: "A voucher for a coffee and a pastry from the cafe of your choice.", cost: 150, style: .forIndex(2)),
        DIPReward(id: "squishmallow", title: "Squishmallow", detail: "A soft, huggable desk companion, delivered to your office.", cost: 300, style: .forIndex(1)),
        DIPReward(id: "bottle", title: "Owala Bottle", detail: "A colourful insulated water bottle that keeps drinks cold all day.", cost: 450, style: .forIndex(0)),
        DIPReward(id: "lunch", title: "Team Lunch", detail: "Lunch on us for you and up to three colleagues.", cost: 800, style: .forIndex(3)),
        DIPReward(id: "projector", title: "Mini Projector", detail: "A pocket projector for movie nights and sharing slides anywhere.", cost: 1200, style: .forIndex(4)),
        DIPReward(id: "dayoff", title: "Extra Day Off", detail: "One additional paid day off, agreed with your manager.", cost: 2000, style: .forIndex(5)),
    ]

    /// Progress toward the cheapest reward the member cannot yet afford; nil when everything is affordable.
    static func nextGoal(balance: Int, in rewards: [DIPReward]) -> (reward: DIPReward, progress: Double)? {
        guard let next = rewards.filter({ !$0.isAffordable(balance: balance) }).min(by: { $0.cost < $1.cost }) else { return nil }
        return (next, min(1, Double(balance) / Double(next.cost)))
    }
}
