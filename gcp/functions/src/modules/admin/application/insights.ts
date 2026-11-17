import { logger } from "firebase-functions/v2";
import type {
  GetCompanyInsightsResponse, InsightsActivityDay, InsightsChallenges, InsightsContent, InsightsCurrentTheme, InsightsEvents, InsightsMembers,
  InsightsParticipation, InsightsPoints, InsightsTopEvent, InsightsTopMember,
} from "../../../generated/models";
import { errorDiagnostics } from "../domain/errors";
import {
  ACTIVE_SAMPLE_LIMIT, ATTENDANCE_SAMPLE_EVENTS, RECENT_CHALLENGES, attendanceRate, cacheAge, cacheUsable, dayBuckets, distinctStrings, isDate,
  monthBounds, toCount,
} from "../domain/insights";
import { paths } from "../domain/ops";
import { parseGetCompanyInsights } from "../domain/requests";
import { authorize, requireCaller, consumeAfterAuth } from "./context";
import type { AdminDeps, Caller } from "./ports";

export type InsightsSection = NonNullable<GetCompanyInsightsResponse["unavailable"]>[number];

/**
 * getCompanyInsightsV1 (insights.read: organizer, admin). Design: a short-lived server-owned cache document
 * `companies/{c}/insights/summary` (10 minutes) in front of aggregation queries. count()/sum() queries cost one
 * read per 1000 index entries, and the few document reads are bounded (see the limits in domain/insights.ts),
 * so a recompute is bounded at roughly 1,200 billed reads (1,000 sampled RSVPs, 60 day counts, up to 25 attendance counts, a few dozen documents) for a company of any size and nothing scans unbounded. The cache
 * holds the admin view; organizers get it with `points` removed. A cache write failure never fails the read.
 *
 * Every section is best effort: a failing query (a missing index, a timeout) marks its section in `unavailable`,
 * is logged with the Firestore code, message and index link, and the rest of the Overview still renders. A
 * partial summary is not cached, so the next load retries the failed sections.
 */
export async function getCompanyInsights(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<GetCompanyInsightsResponse> {
  const authenticated = requireCaller(caller);
  const req = parseGetCompanyInsights(data);
  await consumeAfterAuth(deps, authenticated, req.companyId, "insights.read");
  const actor = await deps.store.runReadOnly(tx => authorize(tx, authenticated, req.companyId, "insights.read"));
  const now = deps.now();
  const cachePath = paths.insightsSummary(actor.companyId);

  const cached = await deps.store.getDoc(cachePath);
  const summary = cached?.version === 1 && typeof cached.summary === "object" && cached.summary !== null && cacheUsable(cacheAge(cached.generatedAt, now), req.refresh)
    ? (cached.summary as GetCompanyInsightsResponse)
    : null;
  if (summary) return project(summary, actor.role);

  const fresh = await compute(deps, actor.companyId, now);
  if (!fresh.unavailable?.length) {
    try {
      await deps.store.setDoc(cachePath, { version: 1, generatedAt: now, summary: fresh });
    } catch {
      // The cache is an optimization; the numbers are still correct.
    }
  }
  return project(fresh, actor.role);
}

/** Organizers never receive points or member balances (nor learn whether the points section failed). */
export function project(summary: GetCompanyInsightsResponse, role: string): GetCompanyInsightsResponse {
  if (role === "admin") return summary;
  const { points: _points, unavailable, ...rest } = summary;
  const visible = (unavailable ?? []).filter(s => s !== "points");
  return visible.length > 0 ? { ...rest, unavailable: visible } : rest;
}

const eq = (field: string, value: unknown) => [field, "==", value] as const;
const idOf = (path: string) => path.split("/").pop()!;
const sum = (values: ReadonlyArray<number>) => values.reduce((n, v) => n + v, 0);

async function compute(deps: AdminDeps, companyId: string, now: Date): Promise<GetCompanyInsightsResponse> {
  const { store } = deps;
  const days = dayBuckets(now);
  const windowStart = days[0]!.from;
  const month = monthBounds(now);
  const events = { collection: paths.events(companyId) };
  const rsvpGroup = { group: "rsvps" };
  const unavailable = new Set<InsightsSection>();

  /** Runs one section; a failure is logged (codes, message, index link; no member data) and yields the fallback. */
  const section = async <T>(name: InsightsSection, fallback: T, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      unavailable.add(name);
      logger.error("getCompanyInsightsV1 section failed", { companyId, section: name, ...errorDiagnostics(error) });
      return fallback;
    }
  };

  // Daily counts are shared by activity, participation (RSVPs) and content (photos). Handlers attach in this tick.
  const perDay = (group: string) => Promise.all(days.map(async day => (await store.aggregate({ group }, [
    eq("companyId", companyId), ["createdAt", ">=", day.from], ["createdAt", "<", day.to],
  ])).count));
  const rsvpDays = perDay("rsvps");
  const photoDays = perDay("photos");
  const zeroDays: InsightsActivityDay[] = days.map(d => ({ date: d.date, rsvps: 0, photos: 0 }));

  const [members, eventCounts, participation, content, challenges, points, activity] = await Promise.all([
    section<InsightsMembers>("members", { total: 0, active: 0, deactivated: 0, invited: 0, activeLast30Days: 0, activeCapped: false }, async () => {
      const [total, deactivated, invited, activeSample] = await Promise.all([
        store.aggregate({ collection: "users" }, [eq("companyId", companyId)]),
        store.aggregate({ collection: "users" }, [eq("companyId", companyId), eq("status", "deactivated")]),
        store.aggregate({ collection: paths.roster(companyId) }, [eq("status", "invited")]),
        store.queryDocs(rsvpGroup, { where: [eq("companyId", companyId), ["createdAt", ">=", windowStart]], select: ["userId"], orderBy: "createdAt", descending: true, limit: ACTIVE_SAMPLE_LIMIT }),
      ]);
      return {
        total: total.count, active: Math.max(0, total.count - deactivated.count), deactivated: deactivated.count, invited: invited.count,
        activeLast30Days: distinctStrings(activeSample.map(d => d.data.userId)), activeCapped: activeSample.length >= ACTIVE_SAMPLE_LIMIT,
      };
    }),
    section<InsightsEvents>("events", { upcoming: 0, thisMonth: 0, completed: 0, cancelled: 0 }, async () => {
      const [upcoming, thisMonth, completed, cancelled] = await Promise.all([
        store.aggregate(events, [eq("status", "scheduled"), ["startTime", ">=", now]]),
        store.aggregate(events, [["startTime", ">=", month.from], ["startTime", "<", month.to]]),
        store.aggregate(events, [eq("status", "completed")]),
        store.aggregate(events, [eq("status", "cancelled")]),
      ]);
      return { upcoming: upcoming.count, thisMonth: thisMonth.count, completed: completed.count, cancelled: cancelled.count };
    }),
    section<InsightsParticipation>("participation", { rsvpsLast30Days: 0, attendanceRate: null, attendanceSample: 0, topEvents: [] }, async () => {
      const [rsvps, topEventDocs, completedDocs] = await Promise.all([
        rsvpDays,
        store.queryDocs(events, { where: [], orderBy: "attendeeCount", descending: true, select: ["title", "startTime", "attendeeCount", "capacity", "status"], limit: 10 }),
        store.queryDocs(events, { where: [eq("status", "completed")], orderBy: "startTime", descending: true, select: ["attendeeCount"], limit: ATTENDANCE_SAMPLE_EVENTS }),
      ]);
      const sample = completedDocs.map(d => ({ id: idOf(d.path), going: toCount(d.data.attendeeCount) })).filter(s => s.going > 0);
      const checked = await Promise.all(sample.map(async s => ({
        going: s.going, checkedIn: (await store.aggregate({ collection: paths.rsvps(companyId, s.id) }, [eq("status", "going"), eq("checkedIn", true)])).count,
      })));
      const topEvents: InsightsTopEvent[] = topEventDocs
        .filter(d => (d.data.status === "scheduled" || d.data.status === "completed") && toCount(d.data.attendeeCount) > 0 && isDate(d.data.startTime))
        .slice(0, 5)
        .map(d => ({
          eventId: idOf(d.path), title: String(d.data.title ?? "").slice(0, 120), startTime: (d.data.startTime as Date).toISOString(),
          attendeeCount: toCount(d.data.attendeeCount), capacity: toCount(d.data.capacity), status: d.data.status as "scheduled" | "completed",
        }));
      return { rsvpsLast30Days: sum(rsvps), attendanceRate: attendanceRate(checked), attendanceSample: checked.length, topEvents };
    }),
    section<InsightsContent>("content", { photosLast30Days: 0, commentsLast30Days: 0 }, async () => {
      const [photos, comments] = await Promise.all([
        photoDays,
        store.aggregate({ group: "comments" }, [eq("companyId", companyId), ["createdAt", ">=", windowStart]]),
      ]);
      return { photosLast30Days: sum(photos), commentsLast30Days: comments.count };
    }),
    section<InsightsChallenges>("challenges", { pendingReviews: 0 }, async () => {
      const challengeDocs = await store.queryDocs({ collection: paths.challenges(companyId) }, { where: [], orderBy: "endDate", descending: true, limit: RECENT_CHALLENGES });
      const weekly = challengeDocs.filter(d => d.data.type === "weekly" && isDate(d.data.startDate) && isDate(d.data.endDate));
      const pendingByTheme = await Promise.all(weekly.map(async d => ({
        d, pending: (await store.aggregate({ collection: paths.submissions(companyId, idOf(d.path)) }, [eq("status", "submitted")])).count,
      })));
      const current = pendingByTheme.find(({ d }) => (d.data.startDate as Date) <= now && (d.data.endDate as Date) >= now);
      const currentTheme: InsightsCurrentTheme | undefined = current && {
        challengeId: idOf(current.d.path), title: String(current.d.data.title ?? "").slice(0, 120),
        startDate: (current.d.data.startDate as Date).toISOString(), endDate: (current.d.data.endDate as Date).toISOString(),
        participantCount: toCount(current.d.data.participantCount), completedCount: toCount(current.d.data.completedCount), pendingReviews: current.pending,
      };
      return { pendingReviews: sum(pendingByTheme.map(t => t.pending)), ...(currentTheme ? { current: currentTheme } : {}) };
    }),
    section<InsightsPoints>("points", { issuedLast30Days: 0, topMembers: [] }, async () => {
      const [issued, topMemberDocs] = await Promise.all([
        store.aggregate({ collection: paths.pointTransactions(companyId) }, [["amount", ">", 0], ["createdAt", ">=", windowStart]], "amount"),
        store.queryDocs({ collection: "users" }, { where: [eq("companyId", companyId)], orderBy: "pointsBalance", descending: true, select: ["displayName", "pointsBalance", "status"], limit: 8 }),
      ]);
      const topMembers: InsightsTopMember[] = topMemberDocs
        .filter(d => d.data.status !== "deactivated" && toCount(d.data.pointsBalance) > 0)
        .slice(0, 5)
        .map(d => ({ userId: idOf(d.path), displayName: String(d.data.displayName ?? "").slice(0, 120), pointsBalance: toCount(d.data.pointsBalance) }));
      return { issuedLast30Days: toCount(issued.sum), topMembers };
    }),
    section<InsightsActivityDay[]>("activity", zeroDays, async () => {
      const [rsvps, photos] = await Promise.all([rsvpDays, photoDays]);
      return days.map((day, i) => ({ date: day.date, rsvps: rsvps[i] ?? 0, photos: photos[i] ?? 0 }));
    }),
  ]);

  const order: InsightsSection[] = ["members", "events", "participation", "content", "challenges", "points", "activity"];
  const failed = order.filter(s => unavailable.has(s));
  return {
    contractVersion: 1,
    generatedAt: now.toISOString(),
    windowDays: 30,
    members, events: eventCounts, participation, content, challenges, points, activity,
    ...(failed.length > 0 ? { unavailable: failed } : {}),
  };
}
