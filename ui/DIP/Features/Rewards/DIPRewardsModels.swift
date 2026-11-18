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
        return String(localized: "rewards.raffle.remaining", defaultValue: "\(left) more events to enter", comment: "Rewards raffle card: events still needed to enter the raffle; %lld = number of events left")
    }

    static let raffle = DIPRewardEntry(
        id: "raffle", title: String(localized: "rewards.raffle.title", defaultValue: "Enter the Raffle", comment: "Rewards raffle card title"), subtitle: String(localized: "rewards.raffle.subtitle", defaultValue: "Attend events to win", comment: "Rewards raffle card subtitle"),
        body: String(localized: "rewards.raffle.body", defaultValue: "Mini projector, Squishmallow, and Owala water bottles are up for the taking", comment: "Rewards raffle card: prizes (mock content)"),
        badge: nil, style: .raffle)

    static let discounts: [DIPRewardEntry] = [
        DIPRewardEntry(
            id: "strava", title: "Strava Premium", subtitle: String(localized: "rewards.strava.subtitle", defaultValue: "Exclusive Offer!", comment: "Rewards discount card subtitle (mock content)"),
            body: String(localized: "rewards.strava.body", defaultValue: "20% off Strava’s premium plans within the US, available until March 31st", comment: "Rewards discount card description (mock content)"),
            badge: String(localized: "rewards.strava.badge", defaultValue: "20% off", comment: "Rewards discount card tag (mock content)"), style: .orangeBox),
        DIPRewardEntry(
            id: "nike", title: "Nike Athleisure", subtitle: String(localized: "rewards.nike.subtitle", defaultValue: "Limited Time Only!", comment: "Rewards discount card subtitle (mock content)"),
            body: String(localized: "rewards.nike.body", defaultValue: "15% off all Nike branded activewear except shoes, available until March 25th", comment: "Rewards discount card description (mock content)"),
            badge: String(localized: "rewards.nike.badge", defaultValue: "15% off", comment: "Rewards discount card tag (mock content)"), style: .blueBox),
    ]
}
