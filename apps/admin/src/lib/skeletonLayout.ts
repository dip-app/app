// One place for the sizes and counts that the real Overview page and its loading skeleton share, so the two cannot drift.
// The real components import these (chart height, mock list lengths); the skeleton renders exactly this many rows.

export const OVERVIEW_LAYOUT = {
  /** Stat tiles in `.stat-grid` (the real StatTiles renders eight for every role). */
  tiles: 8,
  /** "Needs attention" rows (typical). */
  pendingRows: 2,
  /** Rows in "Top events by attendees" (the demo company has three events with attendees; production shows up to five). */
  topEventRows: 3,
  /** Rows in "Top members by points" (the server sends at most five). */
  topMemberRows: 5,
  /** Rows in the People card: active, invited, deactivated and the total. */
  peopleRows: 4,
  /** Rows in "Coming up" (the next two weeks, at most five). */
  comingRows: 5,
  /** Rows in "Recent activity" (the latest six audit entries). */
  feedRows: 6,
  /** Interest cards before the tag catalog says how many there are. */
  interestCards: 14,
} as const;

/** Rendered height of the activity chart (px). pro.scss caps `.chart` at this height, the skeleton draws a ghost chart this tall. */
export const CHART_HEIGHT = 220;
/** Interest tile height in the grid view (px); `.tag-card` in _interests.scss uses the same number. */
export const INTEREST_CARD_HEIGHT = 76;

/** Skeletons stay hidden for fast loads, and once shown stay up long enough not to flicker. */
export const SKELETON_DELAY_MS = 150;
// 200 ms: with the 140 ms reveal fade a shorter hold no longer reads as a flicker, and data is not held back as long.
export const SKELETON_MIN_MS = 200;
