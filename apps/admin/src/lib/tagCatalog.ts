import { type Tag, unknownTagName } from "./catalog";

/** Resolves tag IDs (opaque Firestore IDs in production) to display names. Never returns the ID itself. */
export interface TagResolver {
  /** The display name, or "Unknown tag" when the catalog has no such ID. */
  name(id: string): string;
  has(id: string): boolean;
}

export function createTagResolver(tags: readonly Tag[]): TagResolver {
  const byId = new Map(tags.map((tag) => [tag.id, tag.name.trim()] as const));
  return {
    name: (id) => byId.get(id) || unknownTagName(),
    has: (id) => byId.has(id),
  };
}
