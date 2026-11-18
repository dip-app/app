import manifestJson from "../../public/img/covers/manifest.json";
import { asset } from "./asset";
import { THEMES as WEEKLY_THEMES } from "./themes";

// Event cover library: typed view of public/img/covers/manifest.json (owned by scripts/covers; the server reads the
// same manifest through a generated index). Covers are stored as `catalog://default/<category>` (the five legacy
// photos) or `catalog://cover/<key>`; files are served from the site root under /img/covers.

export type CoverThemeKey = "outdoors" | "food" | "arts" | "games" | "music" | "learning" | "volunteering" | "wellness" | "fitness";

export interface CoverEntry {
  key: string;
  /** The URL stored on an event. */
  url: string;
  kind: "photo" | "illustration";
  file: string;
  thumb: string;
  jpeg?: string;
  width: number;
  height: number;
  themes: CoverThemeKey[];
  tags: string[];
  mood: string[];
  season: string[];
  label: string;
  alt: string;
}

interface Manifest { version: number; baseURL: string; themeDefaults: Record<string, string>; covers: CoverEntry[] }
const manifest = manifestJson as unknown as Manifest;

export const COVER_LIBRARY: readonly CoverEntry[] = manifest.covers;
export const THEME_DEFAULT_KEYS: Readonly<Record<string, string>> = manifest.themeDefaults;

/** The nine cover themes in display order, named like the weekly themes. */
export const THEMES: readonly { key: CoverThemeKey; label: string }[] = (
  ["outdoors", "food", "arts", "games", "music", "learning", "volunteering", "wellness", "fitness"] as const
).map((key) => ({ key, label: WEEKLY_THEMES.find((t) => t.key === key)?.displayName ?? key }));

const byURL = new Map(COVER_LIBRARY.map((c) => [c.url, c]));
const byKey = new Map(COVER_LIBRARY.map((c) => [c.key, c]));

/** Resolves a stored cover URL (legacy `catalog://default/*` or `catalog://cover/<key>`) to its entry. */
export function coverByURL(url: string): CoverEntry | undefined {
  const hit = byURL.get(url);
  if (hit) return hit;
  const key = /^catalog:\/\/cover\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(url)?.[1];
  return key ? byKey.get(key) : undefined;
}

/** Full image (preview, cards). Served from the site root, so it carries the portal's base path. */
export const coverImage = (entry: CoverEntry): string => asset(`/img/covers/${entry.file}`);
/** 400 px thumbnail for grids. */
export const coverThumb = (entry: CoverEntry): string => asset(`/img/covers/${entry.thumb}`);

export function themeLabel(key: string): string {
  return THEMES.find((t) => t.key === key)?.label ?? key;
}

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export interface CoverQuery { query?: string; theme?: CoverThemeKey | "" | null }

/** Case-insensitive search over label, tags and alt text: every typed word must prefix a word of the entry. Optional theme filter. */
export function searchCovers({ query = "", theme = null }: CoverQuery = {}): CoverEntry[] {
  const terms = words(query);
  return COVER_LIBRARY.filter((entry) => {
    if (theme && !entry.themes.includes(theme)) return false;
    if (terms.length === 0) return true;
    const hay = words(`${entry.label} ${entry.tags.join(" ")} ${entry.alt}`);
    return terms.every((term) => hay.some((word) => word.startsWith(term)));
  });
}

// ---------- Mock-mode picker (a small local mirror of the server's lexical shortlist; the live callable decides in production)

const STOP = new Set(["the", "and", "for", "with", "our", "your", "you", "all", "any", "are", "from", "this", "that", "join", "team", "event", "come", "will", "bring", "about", "into", "just", "have", "get", "out", "can"]);
const stem = (word: string): string => {
  for (const suffix of ["ing", "es", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
};
const tokens = (text: string): string[] => words(text).filter((w) => !STOP.has(w)).map(stem);

const TAG_THEME: Record<string, CoverThemeKey> = {
  "tag-outdoors": "outdoors", "tag-food": "food", "tag-cooking": "food", "tag-arts": "arts", "tag-games": "games", "tag-hype": "games",
  "tag-social": "games", "tag-music": "music", "tag-learning": "learning", "tag-volunteering": "volunteering", "tag-wellness": "wellness",
  "tag-chill": "wellness", "tag-fitness": "fitness", "tag-energetic": "fitness",
};

// pickEventCoverV1 wire types (docs/contracts/callables.md)
export interface PickEventCoverInput {
  title: string;
  description?: string;
  tagIds?: string[];
  theme?: CoverThemeKey;
  excludeCoverImageURLs?: string[];
}
export type CoverPickSource = "dipbot" | "match" | "default";
export interface PickEventCoverResult {
  coverImageURL: string;
  source: CoverPickSource;
  provider: "jev" | "openai" | "heuristic" | null;
  alternatives: string[];
}

export interface CoverEvent { title: string; description?: string; tagIds?: readonly string[]; theme?: CoverThemeKey | "" | null }

/**
 * Deterministic pick: tag match 3, label/alt word 1 (title words count double), theme 2, illustration -1, excluded
 * covers last; ties by key. With no text match the theme default wins, else the outdoors photo.
 */
export function lexicalPick(event: CoverEvent, exclude: readonly string[] = []): CoverEntry {
  const title = new Set(tokens(event.title));
  const body = new Set(tokens((event.description ?? "").slice(0, 600)));
  const weight = (word: string) => (title.has(word) ? 2 : body.has(word) ? 1 : 0);
  const themes = new Set<string>(event.theme ? [event.theme] : (event.tagIds ?? []).map((id) => TAG_THEME[id]).filter(Boolean));
  const out = new Set(exclude);
  let best: { entry: CoverEntry; score: number } | null = null;
  let anyText = false;
  for (const entry of [...COVER_LIBRARY].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    let text = 0;
    for (const tag of entry.tags) {
      const parts = tokens(tag);
      if (parts.length && parts.every((p) => weight(p) > 0)) text += 3 * Math.max(...parts.map(weight));
    }
    for (const word of new Set(tokens(`${entry.label} ${entry.alt}`))) text += weight(word);
    if (text > 0) anyText = true;
    // Unlike the server's soft -4 on a shortlist, an excluded cover only wins when nothing else is left (keeps mock drafts varied).
    const score = text + (entry.themes.some((t) => themes.has(t)) ? 2 : 0) - (entry.kind === "illustration" ? 1 : 0) - (out.has(entry.url) ? 1000 : 0);
    if (!best || score > best.score) best = { entry, score };
  }
  const fallback = () => {
    const pool = [...themes].map((t) => byKey.get(THEME_DEFAULT_KEYS[t])).filter((c): c is CoverEntry => !!c && !out.has(c.url));
    return pool[0] ?? byURL.get("catalog://default/outdoors") ?? COVER_LIBRARY[0];
  };
  return anyText && best ? best.entry : fallback();
}
