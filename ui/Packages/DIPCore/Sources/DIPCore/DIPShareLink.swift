import Foundation

/// Share links for events: `https://<host>/e/<eventId>`, and the in-app `dip://events/<eventId>` form
/// used by push payloads. The URL carries ONLY the opaque event id (no company id, title or personal data).
/// Authorization stays server-side: the app resolves the id against the signed-in member's company.
public enum DIPShareLink {
    /// The ONE place that names the public domain. Swap in a custom subdomain here (and in
    /// `ui/project.yml` associated domains and the hosting AASA file, see docs/design/share-links.md).
    public static let baseURL = URL(string: "https://letsdip.work")!

    /// Custom scheme of push-payload deep links (`dip://events/{id}`).
    public static let appScheme = "dip"

    private static let maxIDLength = 128

    /// `https://<host>/e/<eventId>`, or nil for an id that is not a plain opaque id (empty, too long, containing `/`).
    public static func url(forEventID eventID: String) -> URL? {
        guard isValidID(eventID) else { return nil }
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove("/")
        guard let encoded = eventID.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return URL(string: baseURL.absoluteString + "/e/" + encoded)
    }

    /// The event id of a share link (`https://<host>/e/<id>`) or a push deep link
    /// (`dip://events/<id>[/chat]`); nil for any other host, scheme or path.
    public static func eventID(from url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.user == nil, components.password == nil else { return nil }
        let scheme = components.scheme?.lowercased()
        let host = components.host?.lowercased()
        let segments = components.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        // Empty segments inside the path ("/e//x") are not a share link.
        if components.percentEncodedPath.contains("//") { return nil }

        let encodedID: String
        if scheme == "https", components.port == nil || components.port == 443, host == baseURL.host?.lowercased() {
            guard segments.count == 2, segments[0] == "e" else { return nil }
            encodedID = segments[1]
        } else if scheme == appScheme, host == "events", components.port == nil {
            guard segments.count == 1 || (segments.count == 2 && segments[1] == "chat") else { return nil }
            encodedID = segments[0]
        } else {
            return nil
        }
        guard let id = encodedID.removingPercentEncoding, isValidID(id) else { return nil }
        return id
    }

    /// Where a link points: the event, and whether it asks for the chat (`dip://events/<id>/chat`, push taps).
    public struct Destination: Equatable, Sendable {
        public let eventID: String
        public let opensChat: Bool
        public init(eventID: String, opensChat: Bool) { self.eventID = eventID; self.opensChat = opensChat }
    }

    public static func destination(from url: URL) -> Destination? {
        guard let id = eventID(from: url) else { return nil }
        let chat = URLComponents(url: url, resolvingAgainstBaseURL: false).map {
            let segments = $0.percentEncodedPath.split(separator: "/")
            return $0.scheme?.lowercased() == appScheme && segments.count == 2 && segments[1] == "chat"
        } ?? false
        return Destination(eventID: id, opensChat: chat)
    }

    private static func isValidID(_ id: String) -> Bool {
        !id.isEmpty && id.count <= maxIDLength && !id.contains("/")
            && id.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) && !CharacterSet.whitespacesAndNewlines.contains($0) }
    }
}
