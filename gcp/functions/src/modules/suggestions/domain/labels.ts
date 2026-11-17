import type { DataLevel } from "./signals";

export type FitLabel = "perfect" | "great" | "good";

/** Composite thresholds for the friendly fit labels (never shown as percentages). */
export const FIT_THRESHOLDS = { perfect: 0.78, great: 0.66, good: 0.55 } as const;

export const FIT_LABEL_TEXT: Readonly<Record<FitLabel, string>> = {
  perfect: "Perfect fit", great: "Great choice", good: "Good match",
};

/** A label only for strong matches, and none when the company has no data yet. */
export function fitLabel(score: number, dataLevel: DataLevel): FitLabel | null {
  if (dataLevel === "none") return null;
  if (score >= FIT_THRESHOLDS.perfect) return "perfect";
  if (score >= FIT_THRESHOLDS.great) return "great";
  if (score >= FIT_THRESHOLDS.good) return "good";
  return null;
}
