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
    accent: "#FB72E4", // challengeAccent
    goalUnits: ["workouts", "classes", "walks", "minutes"],
    defaultGoal: 3,
    defaultTagName: "Fitness",
    defaultDescription: "Get moving with coworkers this week: try a class, a walk or a workout together and log it.",
    submissionPrompt: "Share a photo or a few words about your workout, class or walk.",
    whyItsFun: "The easiest team win: everyone moves a little, and a lunchtime walk counts.",
  },
  {
    key: "sleep",
    displayName: "Sleep",
    url: `${THEME_URL_PREFIX}sleep`,
    illustration: "/img/themes/sleep.png",
    accent: "#1E212B", // ACCENTS.md
    goalUnits: ["nights", "hours"],
    defaultGoal: 5,
    defaultTagName: "Sleep",
    defaultDescription: "Rest up with coworkers this week: pick a wind-down routine, trade your best bedtime tips and log each night you stick to it.",
    submissionPrompt: "Share your wind-down routine or a bedtime win from this week.",
    whyItsFun: "Swapping cozy evening habits gets people talking, and everyone shows up Monday with better stories.",
  },
  {
    key: "hydration",
    displayName: "Hydration",
    url: `${THEME_URL_PREFIX}hydration`,
    illustration: "/img/themes/hydration.png",
    accent: "#7B88FA", // ACCENTS.md
    goalUnits: ["refills", "glasses", "bottles"],
    defaultGoal: 10,
    defaultTagName: "Hydration",
    defaultDescription: "Sip up with coworkers this week: keep your bottle close, top it off through the day and log every refill.",
    submissionPrompt: "Post your water bottle, your favorite refill spot or a fun flavor idea.",
    whyItsFun: "Low effort and very visible: desks fill up with bottle photos and friendly refill races.",
  },
  {
    key: "mindfulness",
    displayName: "Mindfulness",
    url: `${THEME_URL_PREFIX}mindfulness`,
    illustration: "/img/themes/mindfulness.png",
    accent: "#FFCC3E", // ACCENTS.md
    goalUnits: ["breaks", "minutes", "sessions"],
    defaultGoal: 5,
    defaultTagName: "Mindfulness",
    defaultDescription: "Take a breather with coworkers this week: step away for a few quiet minutes to stretch, breathe or go screen free, and log each pause.",
    submissionPrompt: "Share where you took your pause or what helped you reset.",
    whyItsFun: "Short, calm breaks that fit between meetings and give the whole team a reason to slow down together.",
  },
  {
    key: "outdoors",
    displayName: "Outdoors",
    url: `${THEME_URL_PREFIX}outdoors`,
    illustration: "/img/themes/outdoors.png",
    accent: "#6BFF9B", // ACCENTS.md
    goalUnits: ["outings", "walks", "minutes"],
    defaultGoal: 3,
    defaultTagName: "Outdoors",
    defaultDescription: "Get outside with coworkers this week: take a walk, eat lunch in the park or hold a meeting under the open sky, and log it.",
    submissionPrompt: "Share a photo of where you spent time outside.",
    whyItsFun: "Fresh air and new scenery, with great photo moments and easy plans for a team walk.",
  },
  {
    key: "kindness",
    displayName: "Kindness",
    url: `${THEME_URL_PREFIX}kindness`,
    illustration: "/img/themes/kindness.png",
    accent: "#FF7C73", // ACCENTS.md
    goalUnits: ["acts", "notes", "shout-outs"],
    defaultGoal: 5,
    defaultTagName: "Kindness",
    defaultDescription: "Spread some good with coworkers this week: say thanks, lend a hand or leave a kind note, and log each act.",
    submissionPrompt: "Tell us about a kind act you gave or received, and skip names if you prefer.",
    whyItsFun: "Small gestures add up fast, and seeing them posted makes the whole office feel warmer.",
  },
  {
    key: "learning",
    displayName: "Learning",
    url: `${THEME_URL_PREFIX}learning`,
    illustration: "/img/themes/learning.png",
    accent: "#66D9FF", // ACCENTS.md
    goalUnits: ["lessons", "sessions", "chapters", "minutes"],
    defaultGoal: 3,
    defaultTagName: "Learning",
    defaultDescription: "Learn something new with coworkers this week: read a chapter, try a short lesson or teach a teammate a trick, and log it.",
    submissionPrompt: "Share one thing you learned or the lesson you tried.",
    whyItsFun: "Curiosity is contagious: people compare finds, recommend favorites and teach each other on the spot.",
  },
  {
    key: "creativity",
    displayName: "Creativity",
    url: `${THEME_URL_PREFIX}creativity`,
    illustration: "/img/themes/creativity.png",
    accent: "#FB72E4", // ACCENTS.md
    goalUnits: ["creations", "sketches", "projects"],
    defaultGoal: 3,
    defaultTagName: "Creativity",
    defaultDescription: "Make something with coworkers this week: sketch, write, build or craft, then share what you created.",
    submissionPrompt: "Post a photo of your creation, finished or not.",
    whyItsFun: "No skills required, just a playful reason to put down the keyboard and show off something handmade.",
  },
  {
    key: "cooking",
    displayName: "Cooking",
    url: `${THEME_URL_PREFIX}cooking`,
    illustration: "/img/themes/cooking.png",
    accent: "#FFCC3E", // ACCENTS.md
    goalUnits: ["meals", "recipes", "dishes"],
    defaultGoal: 3,
    defaultTagName: "Cooking",
    defaultDescription: "Cook up something with coworkers this week: try a new recipe, pack a homemade lunch or swap dishes, and log every meal.",
    submissionPrompt: "Share a photo of your dish and what you would change next time.",
    whyItsFun: "Everyone eats anyway, so recipe swaps and lunch photos turn into the week's best group chat.",
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
