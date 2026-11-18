/**
 * The app-assigned avatar for a user id, a port of `DIPAvatarStyle.assigned(forUserID:)`
 * (ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Components/DIPAvatarStyle.swift) so the portal shows the same
 * Crew character the member sees in the app. A pure, stable mapping: 64-bit FNV-1a over the UTF-8 bytes of the id, a
 * SplitMix64 finaliser, then figure (3), mood (3) and palette (6) taken as successive mixed-radix digits.
 * Keep the order of the lists below identical to the Swift enums; the unit test pins pairs computed from the Swift code.
 */
export const FIGURES = ["round", "square", "pill"] as const;
export const MOODS = ["happy", "calm", "wink"] as const;
export const PALETTES = ["periwinkle", "yellow", "pink", "orchid", "grey", "white"] as const;

export type Figure = (typeof FIGURES)[number];
export type Mood = (typeof MOODS)[number];
export type Palette = (typeof PALETTES)[number];
export interface GeneratedAvatar { figure: Figure; mood: Mood; palette: Palette }

/** Brand token fills (tokens.json: actionPrimary, notificationAccent, eventsAccent, challengeAccent, surfaceMuted, surfaceDefault) and the ink (textPrimary). */
export const PALETTE_FILL: Record<Palette, string> = {
  periwinkle: "#7B88FA", yellow: "#FFCC3E", pink: "#F054A5", orchid: "#FB72E4", grey: "#ECECEC", white: "#FFFFFF",
};
export const CREW_INK = "#1E212B";

const MASK = (BigInt(1) << BigInt(64)) - BigInt(1); // BigInt() calls, not literals: the tsconfig target is ES2017

export function fnv1a64(text: string): bigint {
  let hash = BigInt("0xcbf29ce484222325");
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * BigInt("0x100000001b3")) & MASK;
  }
  return hash;
}

export function mixed(input: bigint): bigint {
  let z = (input + BigInt("0x9e3779b97f4a7c15")) & MASK;
  z = ((z ^ (z >> BigInt(30))) * BigInt("0xbf58476d1ce4e5b9")) & MASK;
  z = ((z ^ (z >> BigInt(27))) * BigInt("0x94d049bb133111eb")) & MASK;
  return z ^ (z >> BigInt(31));
}

/** Stable assignment for a user id; an empty id still maps to a valid avatar (as in the app). */
export function generatedAvatarFor(userId: string): GeneratedAvatar {
  let value = mixed(fnv1a64(userId));
  const take = (count: number): number => {
    const part = Number(value % BigInt(count));
    value /= BigInt(count);
    return part;
  };
  const figure = FIGURES[take(FIGURES.length)];
  const mood = MOODS[take(MOODS.length)];
  const palette = PALETTES[take(PALETTES.length)];
  return { figure, mood, palette };
}

/** The same assignment as a readable id, `crew-<figure>-<mood>-<palette>`. */
export function generatedAvatarId(userId: string): string {
  const { figure, mood, palette } = generatedAvatarFor(userId);
  return `crew-${figure}-${mood}-${palette}`;
}
