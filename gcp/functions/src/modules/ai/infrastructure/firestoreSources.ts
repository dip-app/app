import { FirestoreTagStatsStore } from "../../tags/infrastructure/firestoreTagStats";
import type { Firestore } from "firebase-admin/firestore";
import type { CatalogTag, CurrentTheme, InterestSource, InterestStat, TagCatalog, ThemeHistoryRecord, ThemeHistorySource, ThemeSource } from "../application/ports";

/** The default tags seeded by the admin portal (apps/admin/src/lib/catalog.ts). */
export const DEFAULT_TAGS: readonly CatalogTag[] = [
  { id: "tag-fitness", name: "Fitness" }, { id: "tag-energetic", name: "Energetic" }, { id: "tag-hype", name: "Hype" },
  { id: "tag-outdoors", name: "Outdoors" }, { id: "tag-social", name: "Social" }, { id: "tag-cooking", name: "Cooking" },
  { id: "tag-games", name: "Games" }, { id: "tag-chill", name: "Chill" },
  { id: "tag-food", name: "Food & Drink" }, { id: "tag-arts", name: "Arts & Crafts" }, { id: "tag-music", name: "Music" },
  { id: "tag-learning", name: "Learning" }, { id: "tag-volunteering", name: "Volunteering" }, { id: "tag-wellness", name: "Wellness" },
];

/**
 * Interest counts from the tag-counts module (TAG-1/TAG-2, `companies/{c}/tagStats/{tagId}.memberCount`), read through
 * its own store so both features agree on the shape. Exact counts stay on the server; the AI domain buckets them and
 * suppresses tags under 5 members before anything reaches the portal or the model.
 */
export class FirestoreInterestSource implements InterestSource {
  private readonly stats: FirestoreTagStatsStore;

  constructor(db: Firestore) {
    this.stats = new FirestoreTagStatsStore(db);
  }

  async countsFor(companyId: string): Promise<InterestStat[] | null> {
    const stats = await this.stats.listStats(companyId);
    if (stats.length === 0) return null;
    return stats.filter(stat => Number.isSafeInteger(stat.memberCount) && stat.memberCount >= 0);
  }
}

const CATALOG_TTL_MS = 10 * 60_000;

export class FirestoreTagCatalog implements TagCatalog {
  private cached: { at: number; tags: CatalogTag[] } | null = null;

  constructor(private readonly db: Firestore, private readonly clock: () => number = Date.now) {}

  async list(): Promise<CatalogTag[]> {
    const now = this.clock();
    if (this.cached && now - this.cached.at < CATALOG_TTL_MS) return this.cached.tags;
    const snap = await this.db.collection("tags").limit(200).get();
    const rows = snap.docs.map(doc => {
      const data = doc.data();
      const order = typeof data.sortOrder === "number" ? data.sortOrder : Number.MAX_SAFE_INTEGER;
      const name = typeof data.name === "string" && data.name.trim() !== "" ? data.name.trim() : doc.id;
      return { id: doc.id, name, order };
    });
    rows.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const tags = rows.length > 0 ? rows.map(({ id, name }) => ({ id, name })) : DEFAULT_TAGS.map(tag => ({ ...tag }));
    this.cached = { at: now, tags };
    return tags;
  }
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  const maybe = value as { toDate?: () => Date } | null;
  return maybe && typeof maybe.toDate === "function" ? maybe.toDate() : null;
}

export class FirestoreThemeSource implements ThemeSource {
  constructor(private readonly db: Firestore) {}

  async current(companyId: string, now: Date): Promise<CurrentTheme | null> {
    const snap = await this.db.collection(`companies/${companyId}/challenges`)
      .where("type", "==", "weekly").where("endDate", ">=", now).orderBy("endDate").limit(10).get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const start = toDate(data.startDate);
      if (!start || start.getTime() > now.getTime()) continue;
      const title = typeof data.title === "string" ? data.title.trim().slice(0, 120) : "";
      if (title === "") continue;
      const tagIds = Array.isArray(data.tagIds) ? data.tagIds.filter((id): id is string => typeof id === "string").slice(0, 10) : [];
      return { title, tagIds };
    }
    return null;
  }
}

/**
 * Weekly themes in a window for Suggest theme (`companies/{c}/challenges`): one single-field range on `startDate`, so no
 * composite index; non-weekly and malformed documents are skipped. Only title, tags, illustration, window and the
 * participant count are read (the count is bucketed before the model sees it).
 */
export class FirestoreThemeHistory implements ThemeHistorySource {
  constructor(private readonly db: Firestore) {}

  async between(companyId: string, from: Date, to: Date): Promise<ThemeHistoryRecord[]> {
    const snap = await this.db.collection(`companies/${companyId}/challenges`)
      .where("startDate", ">=", from).where("startDate", "<=", to).orderBy("startDate").limit(200).get();
    const out: ThemeHistoryRecord[] = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.type !== "weekly") continue;
      const startDate = toDate(data.startDate);
      const endDate = toDate(data.endDate);
      const title = typeof data.title === "string" ? data.title.trim().slice(0, 120) : "";
      if (!startDate || !endDate || title === "") continue;
      out.push({
        title, startDate, endDate,
        tagIds: Array.isArray(data.tagIds) ? data.tagIds.filter((id): id is string => typeof id === "string").slice(0, 10) : [],
        coverImageURL: typeof data.coverImageURL === "string" ? data.coverImageURL : "",
        participantCount: typeof data.participantCount === "number" && Number.isSafeInteger(data.participantCount) && data.participantCount >= 0 ? data.participantCount : 0,
      });
    }
    return out;
  }
}
