import DIPDesignSystem
import Foundation

/// Mock-backed entries for the Rewards tab (V2-S03 stretch), copied from the Rewards frame in Figma.
/// There is no rewards contract, backend or raffle service yet; nothing here is persisted or redeemable.
struct DIPRewardEntry: Identifiable, Equatable {
    let id: String
    let title: String
    let subtitle: String
    let body: String
    /// Discount tag text such as "20% off"; nil for the raffle.
    let badge: String?
    let style: DIPGiftStyle
}

enum DIPRewardsMock {
    /// Raffle progress shown inside the raffle card (mock): events attended out of events needed.
    static let raffleAttended = 2
    static let raffleNeeded = 3
    static var raffleRemainingText: String {
        let left = raffleNeeded - raffleAttended
        return left == 1 ? "1 more event to enter" : "\(left) more events to enter"
    }

    static let raffle = DIPRewardEntry(
        id: "raffle", title: "Enter the Raffle", subtitle: "Attend events to win",
        body: "Mini projector, Squishmallow, and Owala water bottles are up for the taking",
        badge: nil, style: .raffle)

    static let discounts: [DIPRewardEntry] = [
        DIPRewardEntry(
            id: "strava", title: "Strava Premium", subtitle: "Exclusive Offer!",
            body: "20% off Strava’s premium plans within the US, available until March 31st",
            badge: "20% off", style: .orangeBox),
        DIPRewardEntry(
            id: "nike", title: "Nike Athleisure", subtitle: "Limited Time Only!",
            body: "15% off all Nike branded activewear except shoes, available until March 25th",
            badge: "15% off", style: .blueBox),
    ]
}
