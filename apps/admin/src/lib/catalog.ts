// Default event images from the app's prototype assets (public/img/events). The approved
// catalog is pending design (callables.md); V1 has no uploads.
export interface CoverOption {
  id: string;
  label: string;
  url: string;
  image: string;
}

export const COVERS: CoverOption[] = [
  { id: "fitness", label: "Fitness", url: "catalog://default/fitness", image: "/img/events/fitness.jpg" },
  { id: "outdoors", label: "Outdoors", url: "catalog://default/outdoors", image: "/img/events/outdoors.jpg" },
  { id: "hiking", label: "Hiking", url: "catalog://default/hiking", image: "/img/events/hiking.jpg" },
  { id: "games", label: "Games", url: "catalog://default/games", image: "/img/events/games.jpg" },
  { id: "cooking", label: "Cooking", url: "catalog://default/cooking", image: "/img/events/cooking.jpg" },
];

export function coverFor(url: string): CoverOption | undefined {
  return COVERS.find((cover) => cover.url === url);
}

/** Mirrors tags/{tagId}: events store IDs, never labels. The portal reads the same catalog the app uses. */
export interface Tag { id: string; name: string; }

export const TAGS: Tag[] = [
  { id: "tag-fitness", name: "Fitness" }, { id: "tag-energetic", name: "Energetic" }, { id: "tag-hype", name: "Hype" },
  { id: "tag-outdoors", name: "Outdoors" }, { id: "tag-social", name: "Social" }, { id: "tag-cooking", name: "Cooking" },
  { id: "tag-games", name: "Games" }, { id: "tag-chill", name: "Chill" },
];

export const TAG_IDS = TAGS.map((tag) => tag.id);

export function tagName(id: string): string {
  return TAGS.find((tag) => tag.id === id)?.name ?? id;
}
