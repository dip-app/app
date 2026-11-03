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

export const TAGS = ["Fitness", "Energetic", "Hype", "Outdoors", "Social", "Cooking", "Games", "Chill"];
