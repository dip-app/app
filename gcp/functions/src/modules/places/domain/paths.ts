/** Firestore paths of the places module (server-only; clients never read or write them). */
export const placesPaths = {
  /** Google Places calls of one company on one UTC day (typeahead, resolves, cached venue re-fetches): the PLACES_DAILY_LIMIT counter. */
  usage: (companyId: string, dayKey: string) => `companies/${companyId}/placesUsage/${dayKey}`,
};
