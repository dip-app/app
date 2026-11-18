// Art and one-line copy for interest tags (Dipbot cards). Real catalogs hold production tag names, so resolution goes
// by NAME, never by ID: (a) an explicit table for known names, (b) keyword and synonym rules for unknown names, then
// (c) a deterministic fallback: the generated Crew mascot (the same id -> character mapping as the avatars) on an
// accent tile, keyed by the tag ID, so two unknown tags never share one picture. Decorative: cards name the tag.

import { asset } from "./asset";
import { CREW_INK, PALETTE_FILL, type Palette, fnv1a64, generatedAvatarFor, mixed } from "./generatedAvatar";
import { THEMES } from "./themes";

export interface TagArt { src: string; /** Tile colour behind the transparent art. */ bg: string; kind: "theme" | "spot" | "mascot" }

/** Light tile behind spot art (the portal's selected-row tint family). */
export const SPOT_BG = "#F1F2FD";

type Source = { theme: string } | { spot: string };
const theme = (key: string): Source => ({ theme: key });
const spot = (name: string): Source => ({ spot: name });

/** Normalized tag name (lowercase, "&" to "and", punctuation to spaces) -> art. */
const KNOWN: Record<string, Source> = {
  fitness: theme("fitness"), "weekly activity": theme("fitness"), "water sport": theme("outdoors"), outdoors: theme("outdoors"),
  food: theme("food"), "food and drink": theme("food"), cooking: spot("interest-cooking"),
  creative: theme("arts"), carpentry: theme("arts"), arts: theme("arts"), "arts and crafts": theme("arts"),
  games: theme("games"), music: theme("music"), learning: theme("learning"), volunteering: theme("volunteering"), wellness: theme("wellness"),
  bonding: spot("goal-team_bonding"), social: spot("interest-social"), energetic: spot("interest-energetic"), hype: spot("interest-hype"), chill: spot("interest-chill"),
};

/** Keyword (substring of the normalized name) rules, first match wins; more specific families come first. */
const KEYWORDS: [string[], Source][] = [
  [["volunteer", "charity", "give back", "community", "cleanup"], theme("volunteering")],
  [["yoga", "mind", "relax", "meditat", "wellness", "health", "stretch"], theme("wellness")],
  [["cook", "bake", "meal", "food", "drink", "coffee", "lunch", "dinner", "brunch", "taste", "wine", "beer"], theme("food")],
  [["music", "band", "karaoke", "concert", "sing", "song"], theme("music")],
  [["learn", "class", "workshop", "book", "read", "course", "skill", "teach", "study", "language"], theme("learning")],
  [["game", "trivia", "puzzle", "quiz", "board", "esport", "escape"], theme("games")],
  [["craft", "art", "paint", "wood", "carpent", "pottery", "knit", "draw", "design", "diy", "maker", "photo"], theme("arts")],
  [["sport", "swim", "water", "kayak", "paddle", "sail", "surf", "hike", "walk", "park", "nature", "camp", "beach", "garden", "outdoor", "outside"], theme("outdoors")],
  [["fit", "gym", "run", "workout", "train", "weekly", "exercise", "cycl", "bike", "lift"], theme("fitness")],
  [["bond", "team", "friend", "meet", "mingle", "network", "party", "celebrat"], spot("goal-team_bonding")],
  [["energ", "active"], spot("interest-energetic")],
  [["hype", "festival"], spot("interest-hype")],
  [["chill", "calm", "quiet"], spot("interest-chill")],
  [["social", "hang", "coworker"], spot("interest-social")],
];

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function sourceFor(name: string): Source | null {
  const key = normalizeName(name);
  if (KNOWN[key]) return KNOWN[key];
  const tokens = key.split(" ");
  // A keyword matches the START of a word ("art" matches "arts", not "party"); phrases match anywhere.
  const hit = (w: string) => (w.includes(" ") ? key.includes(w) : tokens.some((tok) => tok.startsWith(w)));
  for (const [words, source] of KEYWORDS) if (words.some(hit)) return source;
  return null;
}

/** Accent tiles for the fallback mascot (brand accents and avatar tones, as the theme tiles use). */
const TILES = ["#7B88FA", "#FB72E4", "#FFCC3E", "#6BE5D0", "#66D9FF", "#6BFF9B", "#FF7C73"] as const;
/** A body that matches its tile would vanish, so each body colour skips the tile of its own tone. */
const SAME_TONE: Partial<Record<Palette, string>> = { periwinkle: "#7B88FA", yellow: "#FFCC3E", orchid: "#FB72E4", pink: "#FB72E4" };

/** Deterministic mascot art for a tag ID: the avatar figure, mood and colour for that id on an accent tile. */
export function mascotArt(id: string): TagArt {
  const av = generatedAvatarFor(id);
  const fill = PALETTE_FILL[av.palette];
  const tiles = TILES.filter((t) => t !== SAME_TONE[av.palette]);
  const bg = tiles[Number(mixed(fnv1a64(`tile:${id}`)) % BigInt(tiles.length))];
  const eyeY = av.figure === "pill" ? 36 : 42;
  const mouthY = eyeY + 16;
  const body = av.figure === "square"
    ? `<rect x="22" y="12" width="76" height="72" rx="20" fill="${fill}"/>`
    : av.figure === "pill"
      ? `<rect x="32" y="6" width="56" height="84" rx="28" fill="${fill}"/>`
      : `<circle cx="60" cy="48" r="38" fill="${fill}"/>`;
  const rightEye = av.mood === "wink"
    ? `<path d="M65 ${eyeY}H73" fill="none" stroke="${CREW_INK}" stroke-width="4.5" stroke-linecap="round"/>`
    : `<circle cx="69" cy="${eyeY}" r="3.8" fill="${CREW_INK}"/>`;
  const mouth = av.mood === "calm" ? `M51 ${mouthY}H69` : `M51 ${mouthY}Q60 ${mouthY + 9} 69 ${mouthY}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 96">${body}<circle cx="51" cy="${eyeY}" r="3.8" fill="${CREW_INK}"/>${rightEye}<path d="${mouth}" fill="none" stroke="${CREW_INK}" stroke-width="4.5" stroke-linecap="round"/></svg>`;
  return { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, bg, kind: "mascot" };
}

/** Art for one interest tag: known name, then synonyms, then the id-keyed mascot. Never one identical picture for all. */
export function tagArt(tag: { id: string; name: string }): TagArt {
  const source = sourceFor(tag.name);
  if (source && "theme" in source) {
    const t = THEMES.find((x) => x.key === source.theme);
    if (t?.illustration) {
      // Fitness ships as PNG only; the others have a lighter SVG next to the PNG.
      return { src: asset(t.key === "fitness" ? t.illustration : t.illustration.replace(/\.png$/, ".svg")), bg: t.accent, kind: "theme" };
    }
  }
  // The interest-* scenes carry their own background (fill the tile); the goal-* spots are transparent (sit on the tint).
  if (source && "spot" in source) return { src: asset(`/img/ai/${source.spot}.svg`), bg: SPOT_BG, kind: source.spot.startsWith("interest-") ? "theme" : "spot" };
  return mascotArt(tag.id);
}

// ---------- Copy: 3 to 5 word blurbs (US English). A `description` on the tag document overrides everything.

const BLURBS: Record<string, string> = {
  fitness: "Workouts, classes, runs", "weekly activity": "Recurring team habits", "water sport": "Paddle, swim, sail", bonding: "Get to know each other",
  energetic: "High-energy group fun", hype: "Big, loud, memorable", cooking: "Cook or bake together", outdoors: "Hikes, parks, fresh air",
  carpentry: "Build something by hand", social: "Mix and mingle", food: "Meals, tastings, treats", "food and drink": "Meals, tastings, treats",
  games: "Board games and trivia", volunteering: "Give back together", creative: "Make art and crafts", "arts and crafts": "Make art and crafts",
  arts: "Make art and crafts", music: "Karaoke, jams, concerts", learning: "Workshops and lunch-and-learns", wellness: "Yoga, stretching, recharging",
  chill: "Low-key and relaxed",
};

/** Fallback blurbs by the art family a keyword match lands on. */
const FAMILY_BLURB: Record<string, string> = {
  fitness: "Get moving together", outdoors: "Fresh air and fun", food: "Good food, shared", arts: "Make something together",
  games: "Play and compete", music: "Make some noise", learning: "Learn something new", volunteering: "Give back together",
  wellness: "Relax and recharge", "goal-team_bonding": "Get to know each other", "interest-energetic": "High-energy group fun",
  "interest-hype": "Big, loud, memorable", "interest-chill": "Low-key and relaxed", "interest-social": "Mix and mingle", "interest-cooking": "Cook or bake together",
};
export const GENERIC_BLURB = "A team favorite";

/** One short line for a tag card: the tag's own `description` if it has one, then the curated blurb, then a keyword family. */
export function tagBlurb(tag: { name: string; description?: string }): string {
  const own = tag.description?.trim();
  if (own) return own;
  const known = BLURBS[normalizeName(tag.name)];
  if (known) return known;
  const source = sourceFor(tag.name);
  if (!source) return GENERIC_BLURB;
  return FAMILY_BLURB["theme" in source ? source.theme : source.spot] ?? GENERIC_BLURB;
}
