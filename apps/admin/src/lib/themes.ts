// Weekly theme catalog (spec "Theme catalog"): a theme's `coverImageURL` is `catalog://theme/<key>` and
// selects a BUNDLED illustration plus accent colour, never a photo. The server accepts only approved keys
// (APPROVED_THEME_URLS); the iOS app has the same catalog (DIPThemeCatalog). Copy and defaults for every
// theme also live in docs/design/theme-catalog.md; keep the three in step.

export interface ThemeOption {
  key: string;
  /** Punchy 1-2 word title; the app shows it in capitals on the Home card. */
  displayName: string;
  url: string;
  /** Illustration under public/img/themes, or null for the neutral fallback. */
  illustration: string | null;
  /** Accent (background) colour behind the illustration. Fitness = challengeAccent in tokens.json. */
  accent: string;
  /** Suggested `goalUnit` values, first is the default. */
  goalUnits: string[];
  /** Default `goal` for a new theme (a whole number of `goalUnits[0]`). */
  defaultGoal: number;
  /** Tag preselected on a new theme when the shared catalog has a tag with this name. */
  defaultTagName: string;
  defaultDescription: string;
  /** What a member posts as proof when they log progress. */
  submissionPrompt: string;
  /** Short "Why it's fun" blurb for the organizer picker. */
  whyItsFun: string;
}

export const THEME_URL_PREFIX = "catalog://theme/";

export const THEMES: ThemeOption[] = [
  {
    key: "fitness",
    displayName: "Fitness",
    url: `${THEME_URL_PREFIX}fitness`,
    illustration: "/img/themes/fitness.png",
    accent: "#FB72E4",
    goalUnits: ["workouts", "classes", "walks", "minutes"],
    defaultGoal: 3,
    defaultTagName: "Fitness",
    defaultDescription: "Get moving with coworkers this week: try a class, a walk or a workout together and log it.",
    submissionPrompt: "Share a photo or a few words about your workout, class or walk.",
    whyItsFun: "Classes, walks, runs, lifting sessions or a lunchtime stretch: anything that gets people moving counts.",
  },
  {
    key: "outdoors",
    displayName: "Outdoors",
    url: `${THEME_URL_PREFIX}outdoors`,
    illustration: "/img/themes/outdoors.png",
    accent: "#6BFF9B", // (placeholder until ACCENTS.md is updated)
    goalUnits: ["outings", "hours"],
    defaultGoal: 2,
    defaultTagName: "Outdoors",
    defaultDescription: "Get outside with coworkers this week: try a hike, a kayak trip or a picnic in the park, and log your outing.",
    submissionPrompt: "Share a photo of where you went and who came along.",
    whyItsFun: "Hikes, kayak or paddleboard trips, picnics, park days and beach or lake afternoons all fit.",
  },
  {
    key: "food",
    displayName: "Food & Drink",
    url: `${THEME_URL_PREFIX}food`,
    illustration: "/img/themes/food.png",
    accent: "#FFCC3E", // (placeholder until ACCENTS.md is updated)
    goalUnits: ["gatherings", "meals", "tastings"],
    defaultGoal: 2,
    defaultTagName: "Food & Drink",
    defaultDescription: "Gather around good food with coworkers this week: cook together, host a potluck or hit a coffee or lunch spot, and log it.",
    submissionPrompt: "Share a photo of the table, the dish or the spot you tried.",
    whyItsFun: "Potlucks, cooking nights, baking swaps, tastings and coffee or lunch crawls are all fair game.",
  },
  {
    key: "arts",
    displayName: "Arts & Crafts",
    url: `${THEME_URL_PREFIX}arts`,
    illustration: "/img/themes/arts.png",
    accent: "#FF7C73", // (placeholder until ACCENTS.md is updated)
    goalUnits: ["creations", "projects", "sessions"],
    defaultGoal: 2,
    defaultTagName: "Arts & Crafts",
    defaultDescription: "Make something with coworkers this week: paint, throw a pot, knit, take photos or craft, then share what you made.",
    submissionPrompt: "Post a photo of your creation, finished or not.",
    whyItsFun: "Painting nights, pottery classes, knitting circles, photo walks and craft swaps give everyone a way in.",
  },
  {
    key: "games",
    displayName: "Games",
    url: `${THEME_URL_PREFIX}games`,
    illustration: "/img/themes/games.png",
    accent: "#7B88FA", // (placeholder until ACCENTS.md is updated)
    goalUnits: ["games", "sessions", "rounds"],
    defaultGoal: 3,
    defaultTagName: "Games",
    defaultDescription: "Play together this week: board games at lunch, a trivia night, a video game round or an escape room, and log each game.",
    submissionPrompt: "Share a photo or the score from your game.",
    whyItsFun: "Board game lunches, trivia nights, video game tournaments, puzzles and escape rooms are easy to host.",
  },
  {
    key: "music",
    displayName: "Music",
    url: `${THEME_URL_PREFIX}music`,
    illustration: "/img/themes/music.png",
    accent: "#FB72E4", // (placeholder until ACCENTS.md is updated)
    goalUnits: ["songs", "events", "sessions"],
    defaultGoal: 3,
    defaultTagName: "Music",
    defaultDescription: "Make some noise with coworkers this week: sing karaoke, jam together, catch a concert or build a shared playlist, and log it.",
    submissionPrompt: "Share a song, a clip or a photo from your music moment.",
    whyItsFun: "Karaoke nights, jam sessions, concert outings and team playlists work for singers and listeners alike.",
  },
  {
    key: "learning",
    displayName: "Learning",
    url: `${THEME_URL_PREFIX}learning`,
    illustration: "/img/themes/learning.png",
    accent: "#66D9FF", // (placeholder until ACCENTS.md is updated)
    goalUnits: ["lessons", "sessions", "chapters"],
    defaultGoal: 3,
    defaultTagName: "Learning",
    defaultDescription: "Learn something new with coworkers this week: join a workshop, read a chapter for book club, practice a language or host a lunch-and-learn, and log it.",
    submissionPrompt: "Share one thing you learned and where you learned it.",
    whyItsFun: "Workshops, book clubs, language practice and lunch-and-learns let anyone teach or tag along.",
  },
  {
    key: "volunteering",
    displayName: "Volunteering",
    url: `${THEME_URL_PREFIX}volunteering`,
    illustration: "/img/themes/volunteering.png",
    accent: "#6BFF9B", // (placeholder until ACCENTS.md is updated)
    goalUnits: ["shifts", "hours", "events"],
    defaultGoal: 1,
    defaultTagName: "Volunteering",
    defaultDescription: "Give back with coworkers this week: join a cleanup, a food bank shift or a charity drive, or mentor someone, and log your time.",
    submissionPrompt: "Share a photo or a few words about what you helped with.",
    whyItsFun: "Cleanups, food bank shifts, mentoring and charity drives turn a good deed into a team outing.",
  },
  {
    key: "wellness",
    displayName: "Wellness",
    url: `${THEME_URL_PREFIX}wellness`,
    illustration: "/img/themes/wellness.png",
    accent: "#66D9FF", // (placeholder until ACCENTS.md is updated)
    goalUnits: ["sessions", "minutes", "breaks"],
    defaultGoal: 3,
    defaultTagName: "Wellness",
    defaultDescription: "Recharge with coworkers this week: try yoga, a guided meditation or a stretch break, and log each session.",
    submissionPrompt: "Share how you took your pause or a tip that helped you reset.",
    whyItsFun: "Yoga, meditation, stretch breaks, sleep tips and hydration challenges all count as a reset.",
  },
];

export const THEME_URLS = THEMES.map((theme) => theme.url);

/** Neutral gray (tokens `gray`), shown for an unknown or future theme key so nothing crashes. */
export const FALLBACK_ACCENT = "#ECECEC";

export function themeFor(url: string): ThemeOption | undefined {
  return THEMES.find((theme) => theme.url === url);
}

/** Catalog entry, or a neutral fallback that keeps the title only. */
export function resolveTheme(url: string, title = ""): ThemeOption {
  const known = themeFor(url);
  if (known) return known;
  const key = url.startsWith(THEME_URL_PREFIX) ? url.slice(THEME_URL_PREFIX.length) : "";
  return {
    key, displayName: title || key || "Theme", url, illustration: null, accent: FALLBACK_ACCENT,
    goalUnits: [], defaultGoal: 1, defaultTagName: "", defaultDescription: "", submissionPrompt: "", whyItsFun: "",
  };
}
