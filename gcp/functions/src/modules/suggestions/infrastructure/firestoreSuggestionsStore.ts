import { Timestamp, type DocumentData, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import type { PastEvent, UpcomingEvent, WeeklyThemeInfo } from "../domain/signals";
import type { Engine, RankedIdea } from "../domain/rank";
import { aboutFourWeeksBack, previousSixWeeks } from "../application/weekKeys";
import {
  suggestionPaths, type CompanyContext, type DigestClaim, type Schedule, type StoredDigest, type SuggestionsStore,
} from "../application/ports";

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 180;
const UPCOMING_DAYS = 28;
const PAST_LIMIT = 200;
const UPCOMING_LIMIT = 300;
const ADMIN_LIMIT = 200;

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  const maybe = value as { toDate?: () => Date } | null;
  return maybe && typeof maybe.toDate === "function" ? maybe.toDate() : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const int = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return value; } catch { return null; }
}

function readSchedule(data: DocumentData | undefined): Schedule | null {
  if (!data) return null;
  const { weekday, hour } = data;
  return Number.isInteger(weekday) && weekday >= 1 && weekday <= 7 && Number.isInteger(hour) && hour >= 0 && hour <= 23 ? { weekday, hour } : null;
}

const ENGINES: readonly Engine[] = ["jev", "openai", "heuristic"];

function parseIdeas(raw: unknown): RankedIdea[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RankedIdea[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const r = item as Record<string, unknown>;
    if (typeof r.ideaId !== "string" || typeof r.facts !== "string") return null;
    out.push({
      ideaId: r.ideaId,
      score: typeof r.score === "number" ? r.score : 0,
      label: r.label === "perfect" || r.label === "great" || r.label === "good" ? r.label : null,
      reasons: strings(r.reasons),
      whenHint: typeof r.whenHint === "string" ? r.whenHint : null,
      facts: r.facts,
    });
  }
  return out;
}

/** A stored `ready` digest, or null when the document is malformed (the caller then rebuilds it). */
function parseDigest(data: DocumentData | undefined): StoredDigest | null {
  if (!data || data.status !== "ready") return null;
  const ideas = parseIdeas(data.ideas);
  const engine = ENGINES.find(e => e === data.engine);
  const dataLevel = (["none", "some", "rich"] as const).find(l => l === data.dataLevel);
  const createdAt = toDate(data.createdAt);
  const expireAt = toDate(data.expireAt);
  if (!ideas || !engine || !dataLevel || !createdAt || !expireAt || typeof data.weekKey !== "string" || typeof data.weekLabel !== "string") return null;
  const tagCounts: Record<string, number> = {};
  if (typeof data.tagCounts === "object" && data.tagCounts !== null) {
    for (const [k, v] of Object.entries(data.tagCounts as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v)) tagCounts[k] = v;
  }
  return {
    weekKey: data.weekKey, weekLabel: data.weekLabel, engine, dataLevel, dataNote: typeof data.dataNote === "string" ? data.dataNote : null,
    ideas, tagCounts, memberCount: typeof data.memberCount === "number" ? data.memberCount : null, createdAt, expireAt,
  };
}

function digestDocument(digest: StoredDigest): DocumentData {
  return {
    status: "ready",
    weekKey: digest.weekKey,
    weekLabel: digest.weekLabel,
    engine: digest.engine,
    dataLevel: digest.dataLevel,
    dataNote: digest.dataNote,
    ideas: digest.ideas.map(i => ({ ideaId: i.ideaId, score: i.score, label: i.label, reasons: i.reasons, whenHint: i.whenHint, facts: i.facts })),
    tagCounts: digest.tagCounts,
    memberCount: digest.memberCount,
    createdAt: Timestamp.fromDate(digest.createdAt),
    expireAt: Timestamp.fromDate(digest.expireAt),
    leaseUntil: null,
  };
}

/**
 * Admin SDK adapter of the suggestions ports. Collections: `emailSettings` (read), `users` (admins, member counts),
 * `companies/{c}/events`, `companies/{c}/challenges`, `companies/{c}/suggestionsEmail/settings` and
 * `companies/{c}/suggestionDigests/{weekKey}` (TTL on `expireAt`). Every query is equality filters or a single-field range,
 * so no composite index is needed.
 */
export class FirestoreSuggestionsStore implements SuggestionsStore {
  constructor(private readonly db: Firestore) {}

  async listEmailCompanies(limit: number): Promise<string[]> {
    const snap = await this.db.collection("emailSettings").where("enabled", "==", true).limit(limit).get();
    return snap.docs.map(d => d.id);
  }

  async companyContext(companyId: string): Promise<CompanyContext> {
    const [email, ai, schedule] = await this.db.getAll(
      this.db.doc(suggestionPaths.emailSettings(companyId)),
      this.db.doc(`companies/${companyId}/aiSettings/current`),
      this.db.doc(suggestionPaths.schedule(companyId)),
    );
    return {
      emailEnabled: email?.exists === true && email.get("enabled") === true,
      timeZone: email?.exists ? validTimeZone(email.get("timeZone")) : null,
      aiSettings: ai?.exists ? (ai.data() as Record<string, unknown>) : null,
      schedule: schedule?.exists ? readSchedule(schedule.data()) : null,
    };
  }

  async listAdmins(companyId: string): Promise<Array<{ uid: string }>> {
    const snap = await this.db.collection("users").where("companyId", "==", companyId).where("role", "==", "admin").limit(ADMIN_LIMIT).get();
    return snap.docs.filter(d => d.get("status") !== "deactivated").map(d => ({ uid: d.id }));
  }

  async memberCount(companyId: string): Promise<number | null> {
    const users = this.db.collection("users").where("companyId", "==", companyId);
    const [all, off] = await Promise.all([users.count().get(), users.where("status", "==", "deactivated").count().get()]);
    const total = all.data().count - off.data().count;
    return total >= 0 ? total : null;
  }

  async pastEvents(companyId: string, now: Date): Promise<PastEvent[]> {
    const snap = await this.db.collection(`companies/${companyId}/events`)
      .where("startTime", ">=", Timestamp.fromMillis(now.getTime() - HISTORY_DAYS * DAY_MS))
      .where("startTime", "<", Timestamp.fromDate(now)).orderBy("startTime", "desc").limit(PAST_LIMIT).get();
    const out: PastEvent[] = [];
    for (const doc of snap.docs) {
      const start = toDate(doc.get("startTime"));
      const end = toDate(doc.get("endTime"));
      const title = str(doc.get("title"));
      if (!start || !end || !title) continue;
      out.push({
        title, tagIds: strings(doc.get("tagIds")), start, end, capacity: int(doc.get("capacity"), 0), attendeeCount: int(doc.get("attendeeCount"), 0),
        status: str(doc.get("status")) ?? "scheduled", isOutdoor: doc.get("isOutdoor") === true, costCents: int(doc.get("costCents"), 0),
      });
    }
    return out;
  }

  async upcomingEvents(companyId: string, now: Date): Promise<UpcomingEvent[]> {
    const snap = await this.db.collection(`companies/${companyId}/events`)
      .where("startTime", ">=", Timestamp.fromDate(now))
      .where("startTime", "<", Timestamp.fromMillis(now.getTime() + UPCOMING_DAYS * DAY_MS)).orderBy("startTime").limit(UPCOMING_LIMIT).get();
    const out: UpcomingEvent[] = [];
    for (const doc of snap.docs) {
      const start = toDate(doc.get("startTime"));
      const status = String(doc.get("status") ?? "").toLowerCase();
      if (!start || status === "cancelled" || status === "canceled") continue;
      out.push({ start, tagIds: strings(doc.get("tagIds")) });
    }
    return out;
  }

  async weeklyThemes(companyId: string, now: Date): Promise<WeeklyThemeInfo[]> {
    // A weekly theme starts at most a week before now (still running) or within the next four weeks.
    const snap = await this.db.collection(`companies/${companyId}/challenges`)
      .where("startDate", ">=", Timestamp.fromMillis(now.getTime() - 8 * DAY_MS))
      .where("startDate", "<=", Timestamp.fromMillis(now.getTime() + 28 * DAY_MS)).orderBy("startDate").limit(100).get();
    const out: WeeklyThemeInfo[] = [];
    for (const doc of snap.docs) {
      if (doc.get("type") !== "weekly") continue;
      const startDate = toDate(doc.get("startDate"));
      const endDate = toDate(doc.get("endDate"));
      const title = str(doc.get("title"));
      if (!startDate || !endDate || !title || endDate.getTime() < now.getTime()) continue;
      out.push({ title: title.slice(0, 120), tagIds: strings(doc.get("tagIds")).slice(0, 10), startDate, endDate });
    }
    return out.slice(0, 4);
  }

  private async readDigests(companyId: string, weekKeys: readonly string[]): Promise<Array<StoredDigest | null>> {
    const snaps: DocumentSnapshot[] = await this.db.getAll(...weekKeys.map(k => this.db.doc(suggestionPaths.digest(companyId, k))));
    return snaps.map(s => (s.exists ? parseDigest(s.data()) : null));
  }

  async recentIdeaIds(companyId: string, weekKey: string): Promise<string[]> {
    const digests = await this.readDigests(companyId, previousSixWeeks(weekKey));
    return [...new Set(digests.flatMap(d => d?.ideas.map(i => i.ideaId) ?? []))];
  }

  async tagCountsAboutFourWeeksAgo(companyId: string, weekKey: string): Promise<Record<string, number> | null> {
    const digests = await this.readDigests(companyId, aboutFourWeeksBack(weekKey));
    return digests.find(d => d !== null && Object.keys(d.tagCounts).length > 0)?.tagCounts ?? null;
  }

  async getDigest(companyId: string, weekKey: string): Promise<StoredDigest | null> {
    return (await this.readDigests(companyId, [weekKey]))[0] ?? null;
  }

  async claimDigest(companyId: string, weekKey: string, now: Date, leaseMs: number): Promise<DigestClaim> {
    const ref = this.db.doc(suggestionPaths.digest(companyId, weekKey));
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        if (snap.get("status") === "ready") {
          const digest = parseDigest(snap.data());
          if (digest) return { kind: "ready", digest } as const;
        } else {
          const lease = toDate(snap.get("leaseUntil"));
          if (snap.get("status") === "building" && lease && lease.getTime() > now.getTime()) return { kind: "busy" } as const;
        }
      }
      tx.set(ref, {
        status: "building", weekKey, startedAt: Timestamp.fromDate(now), leaseUntil: Timestamp.fromMillis(now.getTime() + leaseMs),
        expireAt: Timestamp.fromMillis(now.getTime() + leaseMs + 7 * DAY_MS),
      });
      return { kind: "claimed" } as const;
    });
  }

  async finishDigest(companyId: string, weekKey: string, digest: StoredDigest): Promise<void> {
    await this.db.doc(suggestionPaths.digest(companyId, weekKey)).set(digestDocument(digest));
  }
}
