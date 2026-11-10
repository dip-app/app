// Weekly theme catalog (spec "Theme catalog"): a theme's `coverImageURL` is `catalog://theme/<key>` and
// selects a BUNDLED illustration plus accent colour, never a photo. The server accepts only approved keys
// (APPROVED_THEME_URLS); the iOS app has the same catalog (DIPThemeCatalog).

export interface ThemeOption {
  key: string;
  displayName: string;
  url: string;
  /** Illustration under public/img/themes, or null for the neutral fallback. */
  illustration: string | null;
  /** Accent colour from ui/DesignSystem/tokens.json (fitness = challengeAccent). */
  accent: string;
  /** Suggested `goalUnit` values, first is the default. */
  goalUnits: string[];
  /** Tag preselected on a new theme when the shared catalog has a tag with this name. */
  defaultTagName: string;
  defaultDescription: string;
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
    defaultTagName: "Fitness",
    defaultDescription: "Get moving with coworkers this week: try a class, a walk or a workout together and log it.",
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
    goalUnits: [], defaultTagName: "", defaultDescription: "",
  };
}
