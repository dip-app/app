import type {
  GetCompanyInsightsResponse, InsightsActivityDay, InsightsCurrentTheme, InsightsTopEvent, InsightsTopMember,
} from "../../../generated/models";
import {
  ACTIVE_SAMPLE_LIMIT, ATTENDANCE_SAMPLE_EVENTS, RECENT_CHALLENGES, attendanceRate, cacheAge, cacheUsable, dayBuckets, distinctStrings, isDate,
  monthBounds, toCount, totalOf,
} from "../domain/insights";
import { paths } from "../domain/ops";
import { parseGetCompanyInsights } from "../domain/requests";
import { authorize, requireCaller } from "./context";
import type { AdminDeps, Caller } from "./ports";

/**
 * getCompanyInsightsV1 (insights.read: organizer, admin). Design: a short-lived server-owned cache document
 * `companies/{c}/insights/summary` (10 minutes) in front of aggregation queries. count()/sum() queries cost one
 * read per 1000 index entries, and the few document reads are bounded (see the limits in domain/insights.ts),
 * so a recompute is bounded at roughly 1,200 billed reads (1,000 sampled RSVPs, 60 day counts, up to 25 attendance counts, a few dozen documents) for a company of any size and nothing scans unbounded. The cache
 * holds the admin view; organizers get it with `points` removed. A cache write failure never fails the read.
 */
export async function getCompanyInsights(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<GetCompanyInsightsResponse> {
  const authenticated = requireCaller(caller);
  const req = parseGetCompanyInsights(data);
  await deps.limiter?.consume(authenticated.uid);
  const actor = await deps.store.runReadOnly(tx => authorize(tx, authenticated, req.companyId, "insights.read"));
  const now = deps.now();
  const cachePath = paths.insightsSummary(actor.companyId);

  const cached = await deps.store.getDoc(cachePath);
  const summary = cached?.version === 1 && typeof cached.summary === "object" && cached.summary !== null && cacheUsable(cacheAge(cached.generatedAt, now), req.refresh)
    ? (cached.summary as GetCompanyInsightsResponse)
    : null;
  if (summary) return project(summary, actor.role);

  const fresh = await compute(deps, actor.companyId, now);
  try {
    await deps.store.setDoc(cachePath, { version: 1, generatedAt: now, summary: fresh });
  } catch {
    // The cache is an optimization; the numbers are still correct.
  }
  return project(fresh, actor.role);
}

/** Organizers never receive points or member balances. */
export function project(summary: GetCompanyInsightsResponse, role: string): GetCompanyInsightsResponse {
  if (role === "admin") return summary;
  const { points: _points, ...rest } = summary;
  return rest;
}

const eq = (field: string, value: unknown) => [field, "==", value] as const;

async function compute(deps: AdminDeps, companyId: string, now: Date): Promise<GetCompanyInsightsResponse> {
  const { store } = deps;
  const days = dayBuckets(now);
  const windowStart = days[0]!.from;
  const month = monthBounds(now);
  const events = { collection: paths.events(companyId) };
  const rsvpGroup = { group: "rsvps" };
  const photoGroup = { group: "photos" };

  const perDay = Promise.all(days.map(async (day): Promise<InsightsActivityDay> => {
    const range = [[ "createdAt", ">=", day.from ], [ "createdAt", "<", day.to ]] as const;
    const [rsvps, photos] = await Promise.all([
      store.aggregate(rsvpGroup, [eq("companyId", companyId), ...range]),
      store.aggregate(photoGroup, [eq("companyId", companyId), ...range]),
    ]);
    return { date: day.date, rsvps: rsvps.count, photos: photos.count };
  }));

  const [
    total, deactivated, invited, upcoming, thisMonth, completed, cancelled, activity, comments, issued,
    activeSample, topEventDocs, completedDocs, challengeDocs, topMemberDocs,
  ] = await Promise.all([
    store.aggregate({ collection: "users" }, [eq("companyId", companyId)]),
    store.aggregate({ collection: "users" }, [eq("companyId", companyId), eq("status", "deactivated")]),
    store.aggregate({ collection: paths.roster(companyId) }, [eq("status", "invited")]),
    store.aggregate(events, [eq("status", "scheduled"), ["startTime", ">=", now]]),
    store.aggregate(events, [["startTime", ">=", month.from], ["startTime", "<", month.to]]),
    store.aggregate(events, [eq("status", "completed")]),
    store.aggregate(events, [eq("status", "cancelled")]),
    perDay,
    store.aggregate({ group: "comments" }, [eq("companyId", companyId), ["createdAt", ">=", windowStart]]),
    store.aggregate({ collection: paths.pointTransactions(companyId) }, [["amount", ">", 0], ["createdAt", ">=", windowStart]], "amount"),
    store.queryDocs(rsvpGroup, { where: [eq("companyId", companyId), ["createdAt", ">=", windowStart]], select: ["userId"], orderBy: "createdAt", descending: true, limit: ACTIVE_SAMPLE_LIMIT }),
    store.queryDocs(events, { where: [], orderBy: "attendeeCount", descending: true, select: ["title", "startTime", "attendeeCount", "capacity", "status"], limit: 10 }),
    store.queryDocs(events, { where: [eq("status", "completed")], orderBy: "startTime", descending: true, select: ["attendeeCount"], limit: ATTENDANCE_SAMPLE_EVENTS }),
    store.queryDocs({ collection: paths.challenges(companyId) }, { where: [], orderBy: "endDate", descending: true, limit: RECENT_CHALLENGES }),
    store.queryDocs({ collection: "users" }, { where: [eq("companyId", companyId)], orderBy: "pointsBalance", descending: true, select: ["displayName", "pointsBalance", "status"], limit: 8 }),
  ]);

  const sample = completedDocs.map(d => ({ id: d.path.split("/").pop()!, going: toCount(d.data.attendeeCount) })).filter(s => s.going > 0);
  const checked = await Promise.all(sample.map(async s => ({
    going: s.going, checkedIn: (await store.aggregate({ collection: paths.rsvps(companyId, s.id) }, [eq("status", "going"), eq("checkedIn", true)])).count,
  })));

  const topEvents: InsightsTopEvent[] = topEventDocs
    .filter(d => (d.data.status === "scheduled" || d.data.status === "completed") && toCount(d.data.attendeeCount) > 0 && isDate(d.data.startTime))
    .slice(0, 5)
    .map(d => ({
      eventId: d.path.split("/").pop()!, title: String(d.data.title ?? "").slice(0, 120), startTime: (d.data.startTime as Date).toISOString(),
      attendeeCount: toCount(d.data.attendeeCount), capacity: toCount(d.data.capacity), status: d.data.status as "scheduled" | "completed",
    }));

  const weekly = challengeDocs.filter(d => d.data.type === "weekly" && isDate(d.data.startDate) && isDate(d.data.endDate));
  const pendingByTheme = await Promise.all(weekly.map(async d => ({
    d, pending: (await store.aggregate({ collection: paths.submissions(companyId, d.path.split("/").pop()!) }, [eq("status", "submitted")])).count,
  })));
  const current = pendingByTheme.find(({ d }) => (d.data.startDate as Date) <= now && (d.data.endDate as Date) >= now);
  const currentTheme: InsightsCurrentTheme | undefined = current && {
    challengeId: current.d.path.split("/").pop()!, title: String(current.d.data.title ?? "").slice(0, 120),
    startDate: (current.d.data.startDate as Date).toISOString(), endDate: (current.d.data.endDate as Date).toISOString(),
    participantCount: toCount(current.d.data.participantCount), completedCount: toCount(current.d.data.completedCount), pendingReviews: current.pending,
  };

  const topMembers: InsightsTopMember[] = topMemberDocs
    .filter(d => d.data.status !== "deactivated" && toCount(d.data.pointsBalance) > 0)
    .slice(0, 5)
    .map(d => ({ userId: d.path.split("/").pop()!, displayName: String(d.data.displayName ?? "").slice(0, 120), pointsBalance: toCount(d.data.pointsBalance) }));

  const activeCount = distinctStrings(activeSample.map(d => d.data.userId));
  return {
    contractVersion: 1,
    generatedAt: now.toISOString(),
    windowDays: 30,
    members: {
      total: total.count, active: Math.max(0, total.count - deactivated.count), deactivated: deactivated.count, invited: invited.count,
      activeLast30Days: activeCount, activeCapped: activeSample.length >= ACTIVE_SAMPLE_LIMIT,
    },
    events: { upcoming: upcoming.count, thisMonth: thisMonth.count, completed: completed.count, cancelled: cancelled.count },
    participation: { rsvpsLast30Days: totalOf(activity, "rsvps"), attendanceRate: attendanceRate(checked), attendanceSample: checked.length, topEvents },
    content: { photosLast30Days: totalOf(activity, "photos"), commentsLast30Days: comments.count },
    challenges: { pendingReviews: pendingByTheme.reduce((n, t) => n + t.pending, 0), ...(currentTheme ? { current: currentTheme } : {}) },
    points: { issuedLast30Days: toCount(issued.sum), topMembers },
    activity,
  };
}
