// Illustrations for Dipbot's choice cards (interest tags resolve in tagArt.ts): the flat spot illustrations in public/img/ai/ (scripts/make-ai-art.py) for the other choices.
// Decorative only: every card names its option in text.

import { asset } from "./asset";
import { SPOT_BG, type TagArt } from "./tagArt";

export { SPOT_BG };

export type Art = TagArt;

export type SpotGroup = "goal" | "size" | "setting" | "budget" | "timing";
export const spotArt = (group: SpotGroup, value: string): Art => ({ src: asset(`/img/ai/${group}-${value}.svg`), bg: SPOT_BG, kind: "spot" });
/** Dipbot's avatar: the purple ghost mascot of the app avatars, on a soft lavender disc. */
export const DIPBOT_ICON = asset("/img/ai/dipbot.svg");
export const stateArt = (name: "thinking" | "results" | "empty") => asset(`/img/ai/state-${name}.svg`);
