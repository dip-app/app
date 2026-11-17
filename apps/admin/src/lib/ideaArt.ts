// Illustrations for Dipbot's cards: the weekly-theme art for interests that have a theme, matching scenes for
// the rest, and the flat spot illustrations in public/img/ai/ (scripts/make-ai-art.py) for the other choices.
// Decorative only: every card names its option in text.

import { THEMES } from "./themes";

export interface Art { src: string; /** Tile colour behind the transparent art. */ bg: string; kind: "theme" | "avatar" | "spot" }

const TAG_THEME: Record<string, string> = {
  "tag-fitness": "fitness", "tag-outdoors": "outdoors", "tag-food": "food", "tag-arts": "arts", "tag-games": "games",
  "tag-music": "music", "tag-learning": "learning", "tag-volunteering": "volunteering", "tag-wellness": "wellness",
};
/** Interests without weekly-theme art get a scene in the same style (public/img/ai/interest-*.svg). */
const TAG_SCENE: Record<string, string> = {
  "tag-social": "social", "tag-cooking": "cooking", "tag-energetic": "energetic", "tag-hype": "hype", "tag-chill": "chill",
};

/** Public files are also served under the basePath, which works in `next dev` and the static export alike. */
const BASE = "/admin";
export const assetUrl = (path: string) => (path.startsWith("/img/") ? BASE + path : path);

/** Light tile behind spot art and avatars (the portal's selected-row tint family). */
export const SPOT_BG = "#F1F2FD";

export function interestArt(tagId: string): Art {
  const theme = THEMES.find((t) => t.key === TAG_THEME[tagId]);
  if (theme?.illustration) {
    const svg = theme.illustration.replace(/\.png$/, ".svg");
    // Fitness ships as PNG only; the others have a lighter SVG next to the PNG.
    return { src: BASE + (theme.key === "fitness" ? theme.illustration : svg), bg: theme.accent, kind: "theme" };
  }
  const scene = TAG_SCENE[tagId];
  if (scene) return { src: `${BASE}/img/ai/interest-${scene}.svg`, bg: SPOT_BG, kind: "theme" };
  return { src: `${BASE}/img/ai/state-thinking.svg`, bg: SPOT_BG, kind: "spot" };
}

export type SpotGroup = "goal" | "size" | "setting" | "budget" | "timing";
export const spotArt = (group: SpotGroup, value: string): Art => ({ src: `${BASE}/img/ai/${group}-${value}.svg`, bg: SPOT_BG, kind: "spot" });
/** Dipbot's avatar: the purple ghost mascot of the app avatars, on a soft lavender disc. */
export const DIPBOT_ICON = `${BASE}/img/ai/dipbot.svg`;
export const stateArt = (name: "thinking" | "results" | "empty") => `${BASE}/img/ai/state-${name}.svg`;
