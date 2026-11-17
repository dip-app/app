// Scout: the portal's name for its AI features (choices, suggestions and drafts). Every user-facing string that names
// the assistant comes from here, so a rename is a one-line change to SCOUT_NAME. Jev (TypeSafe AI) is credited only
// as the provider behind the suggestions ("Powered by Jev"), never as the assistant's name.

export const SCOUT_NAME = "Scout";

export const SCOUT = {
  name: SCOUT_NAME,
  /** Nav item, page title. */
  navLabel: SCOUT_NAME,
  pageTitle: SCOUT_NAME,
  tagline: `Work with ${SCOUT_NAME} to plan your next event`,
  /** The choice-based suggestions feature. */
  suggestsFeature: `${SCOUT_NAME} Suggests`,
  suggestsCount: (n: number) => `${SCOUT_NAME} suggests ${n} ${n === 1 ? "choice" : "choices"}.`,
  /** The note step. */
  askLabel: `Ask ${SCOUT_NAME}`,
  askHeading: `Anything else ${SCOUT_NAME} should know?`,
  noteLabel: `Note for ${SCOUT_NAME} (optional)`,
  /** Results. */
  drafts: `${SCOUT_NAME}’s drafts`,
  /** The "surprise me" interest card. */
  surprise: `Let ${SCOUT_NAME} choose`,
  surpriseHint: "Any interest can fit",
  privacy: `${SCOUT_NAME} sees rounded interest counts, totals of past events and your choices. It never sees names or personal data.`,
  off: `${SCOUT_NAME} is off for your company`,
  adminsOnly: `Only admins can use ${SCOUT_NAME}.`,
  /** Short sentence for the "Admins only" page: "ask an admin to ...". */
  capability: `plan events with ${SCOUT_NAME}`,
} as const;

/** Provider credit shown once per screen (the suggestion banner) and in the tooltip. */
export const POWERED_BY_JEV = "Powered by Jev";
