import type { VenueOption } from "../../../generated/models";

export type VenueKind = VenueOption["kind"];
export type VenueSetting = VenueOption["setting"];

/** includedTypes are Google Places "Table A" types (checked against the place-types documentation on 2026-11-18). */
interface Theme {
  id: string;
  words: RegExp;
  types: readonly string[];
  kinds: readonly VenueKind[];
}

const THEMES: readonly Theme[] = [
  { id: "food", words: /\b(?:food|lunch|dinner|brunch|breakfast|meal|eat\w*|potluck|taco\w*|pizza|cook\w*|tasting|restaurant|cafe|coffee)\b/, types: ["restaurant", "cafe"], kinds: ["restaurant", "cafe", "food_court"] },
  { id: "drinks", words: /\b(?:drinks?|happy hour|pub|bar|brew\w*|beer|wine|cocktail\w*|mocktail\w*|trivia)\b/, types: ["bar", "pub"], kinds: ["bar", "brewery"] },
  { id: "outdoor", words: /\b(?:outdoors?|hik\w*|picnic|walk\w*|trail|nature|park|garden\w*|beach|lake|kayak\w*|cleanup)\b/, types: ["park", "hiking_area", "picnic_ground"], kinds: ["park", "garden", "beach", "trail", "playground"] },
  { id: "culture", words: /\b(?:art|arts|museum|culture|cultural|gallery|theat(?:er|re)|exhibit\w*|paint\w*|pottery|history|concert)\b/, types: ["museum", "art_gallery", "performing_arts_theater"], kinds: ["museum", "gallery", "theatre", "music_venue"] },
  { id: "games", words: /\b(?:games?|gaming|bowling|escape|arcade|puzzle\w*|quiz|karaoke|mini golf|minigolf)\b/, types: ["bowling_alley", "amusement_center", "video_arcade", "miniature_golf_course"], kinds: ["bowling", "escape_room", "arcade", "mini_golf"] },
  { id: "sport", words: /\b(?:sports?|fitness|yoga|workout|exercise|run\w*|climb\w*|swim\w*|soccer|basketball|volleyball|gym|wellness|dance)\b/, types: ["sports_complex", "gym", "sports_club", "swimming_pool"], kinds: ["sports_centre", "fitness", "swimming", "climbing"] },
  { id: "community", words: /\b(?:volunteer\w*|community|charity|donat\w*|workshop|class|learning|training)\b/, types: ["community_center", "event_venue"], kinds: ["community_centre", "library", "event_venue"] },
  { id: "animals", words: /\b(?:zoo|animals?|aquarium|wildlife|farm)\b/, types: ["zoo", "aquarium"], kinds: ["zoo", "aquarium"] },
];

/** Broad set so a search always has candidates, even for an event with no recognizable theme. */
const DEFAULT_TYPES = ["park", "restaurant", "cafe", "museum", "bowling_alley"] as const;
const INDOOR_DEFAULTS = DEFAULT_TYPES.filter(type => type !== "park");
export const MAX_TYPES = 8;
const MAX_THEMED = 6;

export interface EventSignals {
  title: string;
  description?: string | undefined;
  tagIds?: readonly string[] | undefined;
  isOutdoor?: boolean | undefined;
}

export interface DerivedTypes {
  includedTypes: string[];
  /** Theme ids that matched, in order. */
  themes: string[];
  /** Venue kinds that count as a theme match for ranking. */
  kinds: ReadonlySet<VenueKind>;
}

/** Lowercased title, description and tag ids as plain words ("tag-board-games" becomes "tag board games"). */
function textOf(signals: EventSignals): string {
  return [signals.title, signals.description ?? "", ...(signals.tagIds ?? [])].join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

/** Deterministic: the same event signals always give the same place types (at most 8). Event text never leaves this function. */
export function deriveTypes(signals: EventSignals): DerivedTypes {
  const text = textOf(signals);
  const matched = THEMES.filter(theme => theme.words.test(text) || (theme.id === "outdoor" && signals.isOutdoor === true));
  const themed = [...new Set(matched.flatMap(theme => theme.types))].slice(0, MAX_THEMED);
  const defaults = signals.isOutdoor === false ? INDOOR_DEFAULTS : DEFAULT_TYPES;
  const includedTypes = [...new Set([...themed, ...defaults])].slice(0, MAX_TYPES);
  return { includedTypes, themes: matched.map(theme => theme.id), kinds: new Set(matched.flatMap(theme => theme.kinds)) };
}

const TYPE_KIND: Readonly<Record<string, VenueKind>> = {
  park: "park", national_park: "park", state_park: "park", dog_park: "park", picnic_ground: "park", wildlife_park: "park",
  hiking_area: "trail", beach: "beach", garden: "garden", botanical_garden: "garden", playground: "playground",
  restaurant: "restaurant", cafe: "cafe", coffee_shop: "cafe", bakery: "cafe",
  bar: "bar", pub: "bar", wine_bar: "bar", brewery: "brewery", brewpub: "brewery", food_court: "food_court",
  museum: "museum", art_gallery: "gallery", performing_arts_theater: "theatre", movie_theater: "cinema",
  concert_hall: "music_venue", philharmonic_hall: "music_venue", opera_house: "music_venue", amphitheatre: "music_venue",
  bowling_alley: "bowling", amusement_center: "arcade", video_arcade: "arcade", miniature_golf_course: "mini_golf",
  sports_complex: "sports_centre", sports_club: "sports_centre", stadium: "sports_centre", athletic_field: "sports_centre", arena: "sports_centre",
  gym: "fitness", fitness_center: "fitness", yoga_studio: "fitness", swimming_pool: "swimming",
  zoo: "zoo", aquarium: "aquarium", community_center: "community_centre", cultural_center: "community_centre",
  event_venue: "event_venue", banquet_hall: "event_venue", convention_center: "event_venue", wedding_venue: "event_venue",
  library: "library", hotel: "hotel", lodging: "hotel",
};

/** Kind from Google place types; the primary type and the first listed types win. */
export function kindOf(types: readonly string[], primaryType?: string | null): VenueKind {
  for (const type of [...(primaryType ? [primaryType] : []), ...types]) {
    const kind = TYPE_KIND[type] ?? (type.endsWith("_restaurant") ? "restaurant" : undefined);
    if (kind) return kind;
  }
  return "other";
}

const OUTDOOR_KINDS: ReadonlySet<VenueKind> = new Set(["park", "garden", "beach", "trail", "playground", "zoo"]);
const INDOOR_KINDS: ReadonlySet<VenueKind> = new Set([
  "restaurant", "cafe", "bar", "brewery", "food_court", "museum", "gallery", "theatre", "cinema", "music_venue", "bowling", "escape_room",
  "arcade", "climbing", "sports_centre", "fitness", "aquarium", "community_centre", "library", "hotel", "event_venue",
]);

export function settingOf(kind: VenueKind): VenueSetting {
  return OUTDOOR_KINDS.has(kind) ? "outdoor" : INDOOR_KINDS.has(kind) ? "indoor" : "unknown";
}

/** Readable kind for the model's one-line option descriptions. */
export const kindLabel = (kind: VenueKind): string => kind.replace(/_/g, " ");
