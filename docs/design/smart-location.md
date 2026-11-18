# Smart location

Admins and organizers pick the company office and event venues from address and place typeahead, and Dipbot suggests venues near the office ("Find a venue"). This page records the provider decision, the architecture, what is stored and for how long, and the owner's setup steps. Contracts: [callables](../contracts/callables.md#smart-location-places-office-and-venue-search); operations: [AI events ops](../ops/ai-events.md#places-typeahead-venue-search-and-the-office).

## Decision

**Google Places API (New), called only from Cloud Functions with the Functions service account's OAuth token. No API key exists anywhere** (not in the browser, not in Secret Manager, not in the repository). The owner chose it over the free options for data quality and a single product that covers typeahead, address geocoding and point-of-interest search.

Facts the implementation relies on (verified for project `team05-dip`):

- `places.googleapis.com` is enabled.
- Functions run as `28423377357-compute@developer.gserviceaccount.com`, which has `roles/editor` (includes `serviceusage.services.use`), so no IAM grant is needed today. If `roles/editor` is ever removed, the minimum to add is `roles/serviceusage.serviceUsageConsumer`.
- The Places API (New) accepts OAuth 2.0 bearer tokens with scope `https://www.googleapis.com/auth/cloud-platform` plus the header `X-Goog-User-Project: team05-dip` ([OAuth tokens](https://developers.google.com/maps/documentation/places/web-service/oauth-token)). The token comes from the credential `firebase-admin` already holds, so there is no new dependency.
- Every Details, Text Search and Nearby request carries an `X-Goog-FieldMask`, which decides the billing SKU ([data fields](https://developers.google.com/maps/documentation/places/web-service/data-fields)). Autocomplete takes no field mask.

## Provider comparison

Prices and terms were researched on November 18, 2026 and change; recheck before relying on them.

| Provider | Price and free tier | Limits | Storing results | Attribution | Fit |
| --- | --- | --- | --- | --- | --- |
| **Google Places API (New)** ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [sessions](https://developers.google.com/maps/documentation/places/web-service/session-pricing), [policies](https://developers.google.com/maps/documentation/places/web-service/policies)) | Card required ($300 trial credit). Monthly free caps: Autocomplete Requests 10,000 then $2.83 per 1,000; Place Details Essentials 10,000 then $5 per 1,000; Place Details Pro 5,000 then $17 per 1,000; Nearby/Text Search Pro 5,000 then $32 per 1,000; Enterprise 1,000. Autocomplete requests in a session that ends with a Place Details Pro call are free; abandoned sessions bill per request. Text Search with only `places.id` is "Essentials (IDs Only)" | Web service keys should be IP-restricted, which is moot here because no key is used (OAuth) | Only place IDs may be stored indefinitely. Latitude/longitude may be cached up to 30 consecutive days, then must be deleted. Do not copy and save business names or addresses | Google Maps logo, or the text "Google Maps", when results are shown without a Google map | **Chosen** |
| **Geoapify** ([pricing](https://www.geoapify.com/pricing/), [details](https://www.geoapify.com/pricing-details/), [autocomplete](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/), [places](https://apidocs.geoapify.com/docs/places/), [terms](https://www.geoapify.com/terms-and-conditions/)) | Free: 3,000 credits/day, 5 requests/second, commercial use allowed, no card. Paid from $59/month (10,000 credits/day). Autocomplete and geocoding 1 credit each; Places 1 credit per 20 places; Place Details 1 credit | Keys can be restricted by HTTP referrer/origin and by IP | Allowed ("You are free to download and store all the data", [FAQ](https://www.geoapify.com/), [Places API](https://www.geoapify.com/places-api/)) | Free plan: "Powered by Geoapify" link and "© OpenStreetMap contributors" | Documented fallback (free plan, origin-restricted browser key). Not implemented |
| **Photon** ([photon.komoot.io](https://photon.komoot.io/), [source](https://github.com/komoot/photon)) | Free, keyless | Fair use only, heavy use throttled or banned, no SLA. Typeahead only; no radius or category POI search | OSM data | OSM attribution | Not used |
| **Nominatim** (public, [policy](https://operations.osmfoundation.org/policies/nominatim/)) | Free | Max 1 request/second; results must be cached; "you must not implement such a service on the client side using the API" | Must cache | OSM attribution | Not used |
| **Mapbox** ([pricing](https://www.mapbox.com/pricing), [Search Box](https://docs.mapbox.com/api/search/search-box/), [Geocoding](https://docs.mapbox.com/api/search/geocoding/)) | Search Box: 2,500 free sessions, then $11.50 per 1,000; category search 25,000 free, then $1.70 per 1,000. Geocoding v6 temporary: 100,000 free, then $0.75 per 1,000; permanent $5 per 1,000, no free tier | Tokens need a payment method | Search Box results temporary use only; geocoding results must be used with a Mapbox map | Mapbox attribution | Not used |
| **Foursquare Places** ([pricing](https://foursquare.com/pricing/), [usage](https://docs.foursquare.com/fsq-developers-places/reference/usage-guidelines)) | Pro endpoints $15 per 1,000 after a small free allowance (sources conflict: 500 to 10,000) | Paid after the allowance | No caching except `fsq_place_id` | Required | Not used |
| **Overpass** ([wiki](https://wiki.openstreetmap.org/wiki/Overpass_API)) | Free | Light use under 10,000 queries/day on an overloaded public instance; commercial use should self-host; not for typeahead | OSM data | OSM attribution | Not used |

## Cost at our volume

A few hundred typeahead requests a day, most of them inside sessions that end in a Place Details Pro call (those autocomplete requests are free), about 30 to 60 resolves a day, tens of venue searches a day (one Nearby Search each, and a Details Pro re-fetch of up to 5 ids per cache hit), and a daily refresh job that touches few documents. Everything stays inside the monthly free caps (Autocomplete 10,000, Details Essentials 10,000, Details Pro 5,000, Nearby 5,000), so the expected cost is about $0 per month.

Budget guards, in the order they act:

1. `PLACES_DAILY_LIMIT` (default 400 calls per company per UTC day across typeahead, resolves and cached-venue re-fetches; `PLACES_LIMIT` when reached) and a per-user limit of 60 requests per minute.
2. `AI_VENUES_DAILY_LIMIT` (default 40 venue searches per company per UTC day; `VENUE_SEARCH_LIMIT`) and the Dipbot credits.
3. **Owner actions in the Cloud console** (not done by code): a Cloud Billing budget alert at $5 (Billing > Budgets & alerts), and per-day quota caps on the Places API (APIs & Services > Places API (New) > Quotas). These are the hard stop if a code guard ever fails.

## Architecture

```
Browser (admin portal)  --callable-->  Cloud Functions  --OAuth bearer-->  places.googleapis.com
  typeahead, pick, resolve               modules/places                     Autocomplete, Details,
  (App Check, no Google key)             LocationProvider port              Text Search (IDs), Nearby
```

All Google traffic goes through one server port, `LocationProvider` (`modules/places/application/ports.ts`): `autocomplete`, `details` (tiers `pro`, `essentials`, `location`), `searchTextIds` (IDs only) and `searchNearby`. Adapters: `GooglePlaces` (production) and `FakePlaces` (deterministic Pittsburgh data for the emulator, the demo and tests).

| Callable | Who | What |
| --- | --- | --- |
| `autocompletePlacesV1` | organizer, admin (`event.manage`) | Typeahead, biased to the office, at most 5 suggestions; only the typed text, the session token and the office bias reach Google |
| `resolvePlaceV1` | organizer, admin (`event.manage`) | A picked suggestion (`placeId`: Details Pro with the session token, which ends the session) or a typed address (`query`: Text Search IDs only, then Details Essentials on the top id, no name). Nothing found: response without `place` |
| `setCompanyOfficeV1` | admin (`company.manage`) | Takes only a `placeId`; the server resolves it (Details Essentials), so clients cannot forge coordinates. Writes `officeAddress`, `city`, `officeLatitude`, `officeLongitude`, `officePlaceId`, `officeLocationAt`. Rejects 0/0. Audit entry without the address or coordinates |
| `findVenuesV1` | admin (`ai.generate`) | Nearby Search around the office, deterministic ranking, one Jev/OpenAI Choice ranking, 1 Dipbot credit |
| `refreshPlaceLocations` (daily 04:15 UTC) | scheduler | Keeps stored coordinates inside the 30-day limit (below) |

Typeahead is a **pass-through callable**: no key to leak, session pricing works (the session token travels with each call), and App Check protects it. The cost is one callable invocation per debounced keystroke and a latency of roughly 150 to 400 ms when warm. A browser-side key was rejected because it would be a public credential with quota and abuse exposure.

### findVenuesV1 flow

1. Signed-in verified Google account; strict request, optional hints relaxed.
2. `authorize(ai.generate)` against the caller's own membership, then the shared burst limiter.
3. Kill switch: `AI_VENUES_ENABLED=true` and `PLACES_ENABLED=true` (the emulator demo uses canned places), else `AI_VENUES_DISABLED`.
4. Office from `companies/{c}`; missing or 0/0 is `OFFICE_NOT_SET`.
5. Cache `companies/{c}/aiVenueSearches/{sha256}` (24 h). The cache holds only place ids and derived ranking data (kind, setting, reasons, provider). On a hit the server re-fetches Details Pro for those ids (up to 5, counted against `PLACES_DAILY_LIMIT`), recomputes the distance and returns the result with `cached: true, charged: false`, no credit and no Nearby call. If a re-fetch fails or a place vanished, it is a cache miss.
6. One transaction: the daily venue-search cap and the credit charge (`AI_CREDITS_EXHAUSTED` / `VENUE_SEARCH_LIMIT` before any Google call).
7. Nearby Search (`includedTypes` derived from the event, the office circle, at most 20 results, popularity rank). A Google failure refunds the credit and returns `unavailable` / `VENUES_UNAVAILABLE`.
8. Deterministic ranking (theme match, indoor/outdoor fit, distance, group fit; `reasons` from facts only), then one Choice question to Jev, then the cheap OpenAI model, then the heuristic order. Never invented ratings, hours or prices; `website` is always null.
9. The credit is refunded unless Jev or OpenAI ranked. Only model-ranked results are cached.

Only place types, the office coordinates and the radius reach the Nearby request; a test asserts no event text is in any Places request body. Event text reaches only the decision provider, as for covers.

## What we store, where, for how long

| Data | Where | How long | Basis |
| --- | --- | --- | --- |
| Place ID (`venue.placeId`, `officePlaceId`) | Event and company documents | Indefinitely | Allowed by the terms |
| Latitude/longitude | `venue.latitude/longitude` on the event, `officeLatitude/officeLongitude` on the company | At most 30 consecutive days from `venueLocationAt` / `officeLocationAt`, kept fresh by the refresh job | Terms: cache up to 30 days |
| Venue or office name and address text | The event's own fields after the admin confirms or edits them (`venue.name`, `venue.address`, `venue.locality`); `officeAddress`, `city` | With the event or company | These become the admin's own content. **Accepted risk for the owner:** a point-of-interest name chosen from a suggestion is Google content; the terms say not to copy and save business names and addresses, and exempt only a street address the end user could have typed. Admins can edit the text freely |
| Autocomplete suggestion lists | Never stored | Response only | Terms (the suggestion list is not exempt) |
| Venue search cache | `aiVenueSearches`: place ids, kind, setting, reasons, provider | 24 hours (TTL on `expireAt`) | No names, addresses or coordinates |
| Usage counters | `placesUsage`, `aiVenueUsage`: counts only | 3 days (TTL) | |
| Typed text | Never logged or stored | | Logs hold counts and outcome codes only |

**Refresh job.** Google allows caching coordinates for 30 days, so the daily job `refreshPlaceLocations` touches anything older than 25 days (five days of retries if Google is down):

- Event with `venueLocationAt` older than 25 days that is scheduled and has not ended: Place Details with only the `location` field (Essentials) refreshes `venue.latitude/longitude` and `venueLocationAt`.
- Ended or cancelled event, or a place Google no longer knows: `venue.latitude` and `venue.longitude` become 0 (the legacy "no coordinates" value) and `venueLocationAt` is removed; `venue.placeId` stays.
- Company with `officeLocationAt` older than 25 days: coordinates refreshed; a vanished place sets them to 0 (office not set).
- Bounded to 200 documents per collection per run. With `PLACES_ENABLED` off, ended events are still retired (no API needed); nothing is refreshed.

`venueLocationAt` is server-owned: `createEventV1` / `updateEventV1` stamp it when an event has a `venue.placeId` and the place or coordinates are new or changed, keep it when unchanged, and remove it when the place id is gone. Clients cannot send it. Events without a place id keep today's behavior, including 0/0.

## Attribution

Where Google results are shown without a Google map (the suggestion dropdown and the venue results), show the text **Google Maps** (or the Google Maps logo) inside the same container: no line wrap, not translated (`translate="no"`), sans-serif at weight 400, color `#5E5E5E` or `#1F1F1F`, 12 to 16 px ([policies](https://developers.google.com/maps/documentation/places/web-service/policies)). This is a portal responsibility.

## Failure modes

| Failure | Result |
| --- | --- |
| `PLACES_ENABLED` off or no project id | `PLACES_DISABLED`; the portal shows manual fields and the event saves with 0/0 as today |
| Nothing found | Resolve answers without `place`; the portal asks the admin to pick a suggestion |
| Daily cap reached | `PLACES_LIMIT` (typeahead, resolve, office) or `VENUE_SEARCH_LIMIT` (venue search); cached searches still work except that re-fetches count |
| Google 401/403, 429, 5xx, timeout (8 s), malformed body | Typed `PlacesUnavailableError` (`auth`, `rate_limited`, `upstream`, `timeout`, `malformed`); callables answer `unavailable` (`PLACES_UNAVAILABLE`, `VENUES_UNAVAILABLE`); the venue credit is refunded |
| Token cannot be minted (credential problem) | Same as `auth`; check that the Functions service account still has `serviceusage.services.use` |
| Jev and OpenAI down | Heuristic order, credit refunded, not cached |

## Owner setup

No key is created. Steps:

1. Confirm `places.googleapis.com` is enabled on `team05-dip` (it is) and that billing is linked to the project.
2. Create the Cloud Billing budget alert at $5 and set the Places API (New) per-day quota caps (see Cost).
3. Set `PLACES_ENABLED=true` in the functions environment, and `AI_VENUES_ENABLED=true` for venue search. Optional: `PLACES_DAILY_LIMIT`, `AI_VENUES_DAILY_LIMIT`. Deploy `autocompletePlacesV1`, `resolvePlaceV1`, `setCompanyOfficeV1`, `findVenuesV1`, `refreshPlaceLocations` and the Firestore indexes (the `events.venueLocationAt` collection-group override and the TTL policies).
4. If `roles/editor` is removed from the Functions service account, grant it `roles/serviceusage.serviceUsageConsumer`.

## Fallback (not implemented)

If Google is ever dropped, Geoapify on the free plan is the documented replacement: an origin-restricted browser key for typeahead (allowed origins `https://letsdip.work`, `https://www.letsdip.work`, `https://team05-dip.web.app`, `https://team05-dip.firebaseapp.com`, `http://localhost:3000`) and a separate server key in Secret Manager for POI search, with "Powered by Geoapify" and "© OpenStreetMap contributors" attribution. The `LocationProvider` port is the seam for it. Photon could serve typeahead only.
