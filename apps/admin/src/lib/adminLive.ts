import type { FirebaseApp } from "firebase/app";
import {
  type DocumentData, type Firestore, type QueryDocumentSnapshot, Timestamp, collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, startAfter, where,
} from "firebase/firestore";
import { type Functions, httpsCallable } from "firebase/functions";
import { getBlob, getStorage, ref } from "firebase/storage";
import type { AdminOpsApi } from "./adminApi";
import {
  ADMIN_CALLABLES, type AlbumComment, type AlbumPhoto, type ApplyStepResponse, type Attendee, type AuditEntry, type CompanyInfo,
  type AiBucket, type AiConsiderationRank, type AiCredits, type AiStepSuggestion, type AiSuggestionProvider, type AiUsage, type EventIdeaContext, type EventIdeaSuggestions, type GeneratedEventDraft, type GenerateDraftsResult, type BackfillStep, type CompanyInsights, INSIGHTS_SECTIONS, type BugCategory, type BugDiagnostics, type BugReport, type BugReportCounts, type BugStatus, type ImportJobInfo, type ImportPlanResponse, type ImportRow, type Member, type MemberQuery, type Role, type RosterCounts, type RosterRow,
  type Submission,
} from "./adminTypes";
import type { Session } from "./api";
import type { TagStat } from "./tagStats";

// Live adapter for the admin tools, following docs/contracts/admin.md. Lists are Firestore reads allowed by
// the rules (album, RSVPs, teams, roster and audit log for admins); members come from listMembersV1 because
// private profiles stay self-only; every change is a callable. The backend enforces role, tenant and
// idempotency; this file only shapes requests and responses. Not yet verified against a deployed backend.

const iso = (value: unknown): string =>
  value instanceof Timestamp ? value.toDate().toISOString()
    : typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : "";
const str = (value: unknown) => (typeof value === "string" ? value : "");
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const roleOf = (value: unknown): Role => (value === "admin" || value === "organizer" ? value : "member");

/** AdminMemberSummary (listMembersV1 / getMemberV1) -> portal Member. `pointsBalance` is present for admins only. */
export function memberFromSummary(d: DocumentData): Member {
  return {
    id: str(d.userId), email: str(d.email), displayName: str(d.displayName), role: roleOf(d.role), teamIds: strings(d.teamIds),
    workLocation: str(d.workLocation), department: str(d.department), jobTitle: str(d.jobTitle),
    status: d.status === "deactivated" ? "deactivated" : d.status === "invited" ? "invited" : "active",
    pointsBalance: typeof d.pointsBalance === "number" ? d.pointsBalance : null, createdAt: iso(d.createdAt),
    avatarId: str(d.avatarId), photoURL: str(d.photoURL), city: str(d.city), revision: Number(d.revision ?? 0),
  };
}

/** A roster entry (listRosterV1 `RosterEntry`, or the raw document). Claimed entries show their member's status. */
export function rosterFromDoc(id: string, d: DocumentData): RosterRow {
  const claimed = d.status === "claimed";
  return {
    entryId: id, email: str(d.email), displayName: str(d.displayName), role: roleOf(d.role), teamIds: strings(d.teamIds), workLocation: str(d.workLocation),
    department: str(d.department), jobTitle: str(d.jobTitle), managerEmail: str(d.managerEmail), startDate: str(d.startDate),
    state: d.status === "revoked" ? "revoked" : claimed ? (d.memberStatus === "deactivated" ? "deactivated" : "active") : "invited",
    ...(claimed && str(d.claimedBy) ? { memberId: str(d.claimedBy) } : {}), ...(str(d.memberPhotoURL) ? { photoURL: str(d.memberPhotoURL) } : {}), ...(str(d.memberAvatarId) ? { avatarId: str(d.memberAvatarId) } : {}), invitedAt: iso(d.createdAt),
    ...(typeof d.resendCount === "number" && d.resendCount > 0 ? { resendCount: d.resendCount } : {}), ...(iso(d.lastResentAt) ? { lastResentAt: iso(d.lastResentAt) } : {}),
  };
}

/** A `tagStats` document -> portal TagStat. */
export function tagStatFromDoc(id: string, d: DocumentData): TagStat {
  return {
    tagId: str(d.tagId) || id, memberCount: typeof d.memberCount === "number" ? d.memberCount : 0, updatedAt: iso(d.updatedAt),
    ...(iso(d.reconciledAt) ? { reconciledAt: iso(d.reconciledAt) } : {}),
  };
}

const BUCKETS: readonly string[] = ["5-9", "10-19", "20+"];
function usageFromWire(value: unknown): AiUsage {
  const u = obj(value);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    monthlyGenerationLimit: n(u.monthlyGenerationLimit), monthlyGenerationsUsed: n(u.monthlyGenerationsUsed),
    dailyGenerationLimit: n(u.dailyGenerationLimit), dailyGenerationsUsed: n(u.dailyGenerationsUsed),
    generationsRemaining: n(u.generationsRemaining),
  };
}
const DEFAULT_CREDIT_COST = { suggest: 1, generate: 10, regenerate: 10, weeklyEmail: 3, coverPick: 1 };
/** The credits block of a response; a missing or malformed one reads as zero credits left (the paid buttons stay off). */
export function creditsFromWire(value: unknown): AiCredits {
  const c = obj(value);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  const cost = obj(c.creditCost);
  const price = (key: keyof typeof DEFAULT_CREDIT_COST) => (typeof cost[key] === "number" ? n(cost[key]) : DEFAULT_CREDIT_COST[key]);
  return {
    creditsAllowance: n(c.creditsAllowance), creditsUsed: n(c.creditsUsed), creditsRemaining: n(c.creditsRemaining), resetsAt: str(c.resetsAt),
    creditCost: { suggest: price("suggest"), generate: price("generate"), regenerate: price("regenerate"), weeklyEmail: price("weeklyEmail"), coverPick: price("coverPick") },
  };
}
/** GetEventIdeaContextResponse -> EventIdeaContext. */
export function ideaContextFromWire(d: DocumentData): EventIdeaContext {
  const theme = d.currentTheme ? obj(d.currentTheme) : null;
  return {
    enabled: d.enabled === true, interestDataAvailable: d.interestDataAvailable === true,
    topInterests: list(d.topInterests).filter((t) => BUCKETS.includes(str(t.bucket))).map((t) => ({ tagId: str(t.tagId), bucket: str(t.bucket) as AiBucket })),
    thinInterestTagIds: strings(d.thinInterestTagIds),
    ...(theme && str(theme.title) ? { currentTheme: { title: str(theme.title), tagIds: strings(theme.tagIds) } } : {}),
    usage: usageFromWire(d.usage),
    credits: creditsFromWire(d.credits),
  };
}
const SUGGEST_QUESTIONS: readonly string[] = ["interest", "goal", "groupSize", "setting", "budget", "timing"];
const SUGGEST_PROVIDERS: readonly string[] = ["jev", "openai", "heuristic", "none"];
/** GetEventIdeaSuggestionsResponse -> EventIdeaSuggestions; malformed entries are dropped (no suggestion). */
export function suggestionsFromWire(d: DocumentData): EventIdeaSuggestions {
  const provider = (SUGGEST_PROVIDERS.includes(str(d.provider)) ? str(d.provider) : "none") as AiSuggestionProvider;
  const suggestions = list(d.suggestions)
    .filter((s) => SUGGEST_QUESTIONS.includes(str(s.question)) && str(s.value) && typeof s.probability === "number" && s.probability >= 0 && s.probability <= 1)
    .map((s): AiStepSuggestion => ({ question: str(s.question) as AiStepSuggestion["question"], value: str(s.value), probability: s.probability as number, reason: str(s.reason), reasonBasis: s.reasonBasis === "company_data" ? "company_data" : "generic" }));
  const cacheStatus = d.cacheStatus === "fresh" || d.cacheStatus === "stale" ? d.cacheStatus : "computed";
  const considerations = list(d.considerations)
    .filter((c) => str(c.id) && typeof c.probability === "number" && c.probability >= 0 && c.probability <= 1)
    .map((c): AiConsiderationRank => ({ id: str(c.id), probability: c.probability as number }));
  return {
    provider, suggestions, cacheStatus, considerations, creditsCharged: typeof d.creditsCharged === "number" ? d.creditsCharged : 0,
    ...(typeof d.computedAt === "string" ? { computedAt: d.computedAt } : {}),
    ...(d.staleReason === "data" || d.staleReason === "age" ? { staleReason: d.staleReason } : {}),
    ...(d.credits ? { credits: creditsFromWire(d.credits) } : {}),
  };
}
/** GenerateEventDraftsResponse -> GenerateDraftsResult. */
export function draftsFromWire(d: DocumentData): GenerateDraftsResult {
  return { drafts: list(d.drafts).map((x) => x as unknown as GeneratedEventDraft), usage: usageFromWire(d.usage), credits: creditsFromWire(d.credits), replay: d.replay === true };
}

export function auditFromDoc(id: string, d: DocumentData): AuditEntry {
  const changes = Array.isArray(d.changes) ? (d.changes as Record<string, unknown>[]).map((c) => ({ field: str(c.field), before: str(c.before), after: str(c.after) })) : [];
  return {
    id, at: iso(d.createdAt), actorId: str(d.actorId), actorName: str(d.actorName), actorRole: roleOf(d.actorRole), action: str(d.action),
    targetType: (str(d.targetType) || "member") as AuditEntry["targetType"], targetId: str(d.targetId), summary: str(d.summary),
    reason: str(d.reason) || undefined, changes,
  };
}

const bugStatus = (value: unknown): BugStatus => (value === "triaged" || value === "resolved" ? value : "new");
const BUG_CATEGORIES: readonly string[] = ["bug", "confusing", "looksWrong", "idea", "unspecified"];

/** An AdminBugReport from listBugReportsV1 / getBugReportV1. */
export function bugReportFromWire(d: DocumentData): BugReport {
  return {
    id: str(d.id), category: (BUG_CATEGORIES.includes(str(d.category)) ? str(d.category) : "unspecified") as BugCategory, description: str(d.description),
    source: d.source === "profile" ? "profile" : "shake", screen: str(d.screen) || "other", createdAt: iso(d.createdAt), reporterId: str(d.reporterId), reporterName: str(d.reporterName), ...(str(d.reporterPhotoURL) ? { reporterPhotoURL: str(d.reporterPhotoURL) } : {}), ...(str(d.reporterAvatarId) ? { reporterAvatarId: str(d.reporterAvatarId) } : {}),
    ...(str(d.appVersion) ? { appVersion: str(d.appVersion) } : {}), hasScreenshot: d.hasScreenshot === true, status: bugStatus(d.status), hasNote: d.hasNote === true,
    ...(str(d.assigneeId) ? { assigneeId: str(d.assigneeId) } : {}), ...(str(d.assigneeName) ? { assigneeName: str(d.assigneeName) } : {}),
  };
}

/** A ChallengeSubmission from listChallengeSubmissionsV1 (dates arrive as RFC 3339 strings). */
export function submissionFromWire(d: DocumentData): Submission {
  return {
    id: str(d.id), challengeId: str(d.challengeId), userId: str(d.userId), userName: str(d.userName), ...(str(d.photoURL) ? { photoURL: str(d.photoURL) } : {}), ...(str(d.userAvatarId) ? { avatarId: str(d.userAvatarId) } : {}), caption: str(d.caption), progress: Number(d.progress ?? 0),
    status: d.status === "approved" ? "approved" : d.status === "rejected" ? "rejected" : "submitted", createdAt: iso(d.createdAt), updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : iso(d.updatedAt), // sent back verbatim as expectedUpdatedAt
    storagePath: typeof d.storagePath === "string" && d.storagePath ? d.storagePath : null, attempt: Number(d.attempt ?? 1),
    reviewedAt: iso(d.reviewedAt) || null, reviewNote: typeof d.reviewNote === "string" ? d.reviewNote : null, pointsAwarded: Number(d.pointsAwarded ?? 0),
  };
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
const obj = (value: unknown): DocumentData => (value && typeof value === "object" ? (value as DocumentData) : {});
const list = (value: unknown): DocumentData[] => (Array.isArray(value) ? value.map(obj) : []);

/** GetCompanyInsightsResponse -> CompanyInsights. Missing numbers read as zero so a partial response still renders. */
export function insightsFromWire(d: DocumentData): CompanyInsights {
  const members = obj(d.members), events = obj(d.events), participation = obj(d.participation), content = obj(d.content), challenges = obj(d.challenges);
  const current = challenges.current ? obj(challenges.current) : null;
  const points = d.points ? obj(d.points) : null;
  return {
    generatedAt: iso(d.generatedAt), windowDays: num(d.windowDays) || 30,
    members: {
      total: num(members.total), active: num(members.active), deactivated: num(members.deactivated), invited: num(members.invited),
      activeLast30Days: num(members.activeLast30Days), activeCapped: members.activeCapped === true,
    },
    events: { upcoming: num(events.upcoming), thisMonth: num(events.thisMonth), completed: num(events.completed), cancelled: num(events.cancelled) },
    participation: {
      rsvpsLast30Days: num(participation.rsvpsLast30Days),
      attendanceRate: typeof participation.attendanceRate === "number" ? Math.min(1, Math.max(0, participation.attendanceRate)) : null,
      attendanceSample: num(participation.attendanceSample),
      topEvents: list(participation.topEvents).map((e) => ({
        eventId: str(e.eventId), title: str(e.title), startTime: iso(e.startTime), attendeeCount: num(e.attendeeCount), capacity: num(e.capacity),
        status: e.status === "completed" ? "completed" as const : "scheduled" as const,
      })),
    },
    content: { photosLast30Days: num(content.photosLast30Days), commentsLast30Days: num(content.commentsLast30Days) },
    challenges: {
      pendingReviews: num(challenges.pendingReviews),
      current: current && {
        challengeId: str(current.challengeId), title: str(current.title), ...(str(current.coverImageURL) ? { coverImageURL: str(current.coverImageURL) } : {}), startDate: iso(current.startDate), endDate: iso(current.endDate),
        participantCount: num(current.participantCount), completedCount: num(current.completedCount), pendingReviews: num(current.pendingReviews),
      },
      // Optional split of the total per challenge (reviews stay open after a week ends); absent from older servers.
      ...(Array.isArray(challenges.openReviews) ? { openReviews: list(challenges.openReviews).map((r) => ({ challengeId: str(r.challengeId), title: str(r.title), startDate: iso(r.startDate), endDate: iso(r.endDate), count: num(r.count) })) } : {}),
    },
    points: points && {
      issuedLast30Days: num(points.issuedLast30Days),
      topMembers: list(points.topMembers).map((m) => ({ userId: str(m.userId), displayName: str(m.displayName), pointsBalance: num(m.pointsBalance), ...(str(m.photoURL) ? { photoURL: str(m.photoURL) } : {}), ...(str(m.avatarId) ? { avatarId: str(m.avatarId) } : {}) })),
    },
    activity: list(d.activity).map((a) => ({ date: str(a.date), rsvps: num(a.rsvps), photos: num(a.photos) })),
    unavailable: INSIGHTS_SECTIONS.filter((s) => Array.isArray(d.unavailable) && d.unavailable.includes(s)),
  };
}

/** Import rows to EmployeeRecordInput. Blank cells are left out so they keep the current value. */
export function employeeInput(row: ImportRow) {
  return {
    email: row.email,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ...(row.role ? { role: row.role } : {}),
    ...(row.teams.length ? { teamIds: row.teams } : {}),
    ...(row.department ? { department: row.department } : {}),
    ...(row.jobTitle ? { jobTitle: row.jobTitle } : {}),
    ...(row.workLocation ? { workLocation: row.workLocation } : {}),
    ...(row.managerEmail ? { managerEmail: row.managerEmail } : {}),
    ...(row.startDate ? { startDate: row.startDate } : {}),
  };
}

interface Deps {
  app: FirebaseApp;
  db: Firestore;
  functions: Functions;
  organizer: () => Promise<Session>;
  run: <T>(work: () => Promise<T>) => Promise<T>;
}

export function createLiveOps({ app, db, functions, organizer, run }: Deps): AdminOpsApi {
  // Retries of the same action reuse one requestId (a lost response then replays instead of repeating); a success
  // forgets it so the next identical action is new. Callers that hold their own key pass `requestId`.
  const pendingKeys = new Map<string, string>();
  async function call<T = Record<string, unknown>>(name: string, session: Session, payload: Record<string, unknown>, mutating = true): Promise<T> {
    const memo = mutating && typeof payload.requestId !== "string" ? `${name}:${JSON.stringify(payload)}` : "";
    let requestId: string | undefined = typeof payload.requestId === "string" ? payload.requestId : undefined;
    if (mutating && !requestId) {
      requestId = pendingKeys.get(memo) ?? crypto.randomUUID();
      if (pendingKeys.size > 200) pendingKeys.clear();
      pendingKeys.set(memo, requestId);
    }
    const result = await httpsCallable<unknown, T>(functions, name)({
      contractVersion: 1, companyId: session.companyId, ...payload, ...(mutating ? { requestId } : {}),
    });
    if (memo) pendingKeys.delete(memo);
    return result.data;
  }
  const col = (session: Session, ...path: string[]) => collection(db, "companies", session.companyId, ...path);

  /** Follows the cursor to the end: no page cap, so a large company is never silently cut short. */
  async function listMembersAll(session: Session): Promise<Member[]> {
    const members: Member[] = [];
    let pageToken: string | undefined;
    do {
      const data = await call<{ members: DocumentData[]; nextPageToken?: string }>(ADMIN_CALLABLES.listMembers, session, { pageSize: 100, ...(pageToken ? { pageToken } : {}) }, false);
      members.push(...data.members.map(memberFromSummary));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return members.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  async function member(session: Session, id: string): Promise<Member> {
    const data = await call<{ member: DocumentData }>(ADMIN_CALLABLES.getMember, session, { userId: id }, false);
    return memberFromSummary(data.member);
  }

  return {
    companyInfo: () => run(async () => {
      const session = await organizer();
      const [company, teams] = await Promise.all([getDoc(doc(db, "companies", session.companyId)), getDocs(query(col(session, "teams"), limit(100)))]);
      const info: CompanyInfo = {
        id: session.companyId, name: str(company.get("name")), emailDomain: str(company.get("emailDomain")).toLowerCase(),
        teams: teams.docs.filter((t) => t.get("archived") !== true).map((t) => ({ id: t.id, name: str(t.get("name")) || t.id })).sort((a, b) => a.name.localeCompare(b.name)),
      };
      return info;
    }),

    listPhotos: (eventId) => run(async () => {
      const session = await organizer();
      const snap = await getDocs(query(col(session, "events", eventId, "photos"), orderBy("createdAt", "desc"), limit(100)));
      return snap.docs.map((d): AlbumPhoto => ({
        id: d.id, eventId, uploaderId: str(d.get("uploaderId")), uploaderName: str(d.get("uploaderName")), caption: str(d.get("caption")),
        commentCount: Number(d.get("commentCount") ?? 0), createdAt: iso(d.get("createdAt")), storagePath: str(d.get("storagePath")),
      }));
    }),
    listPhotoComments: (eventId, photoId) => run(async () => {
      const session = await organizer();
      const snap = await getDocs(query(col(session, "events", eventId, "photos", photoId, "comments"), orderBy("createdAt"), limit(100)));
      return snap.docs.map((d): AlbumComment => ({
        id: d.id, photoId, authorId: str(d.get("authorId")), authorName: str(d.get("authorName")), text: str(d.get("text")), createdAt: iso(d.get("createdAt")),
      }));
    }),
    // finalizeEventPhotoV1 stores no download URL: bytes are read through the authenticated Storage SDK.
    photoImage: (photo) => run(async () => URL.createObjectURL(await getBlob(ref(getStorage(app), photo.storagePath)))),
    removePhoto: (eventId, photoId, reason) => run(async () => {
      await call(ADMIN_CALLABLES.removePhoto, await organizer(), { eventId, photoId, reason });
    }),
    removePhotoComment: (eventId, photoId, commentId, reason) => run(async () => {
      await call(ADMIN_CALLABLES.removePhotoComment, await organizer(), { eventId, photoId, commentId, reason });
    }),

    listAttendees: (eventId) => run(async () => {
      const session = await organizer();
      // RSVP list rules need the companyId constraint and limit <= 100, so read page by page.
      const docs: QueryDocumentSnapshot[] = [];
      let last: QueryDocumentSnapshot | undefined;
      for (let page = 0; page < 20; page += 1) {
        const snap = await getDocs(query(col(session, "events", eventId, "rsvps"), where("companyId", "==", session.companyId), where("status", "==", "going"), orderBy(documentId()), ...(last ? [startAfter(last)] : []), limit(100)));
        docs.push(...snap.docs);
        last = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < 100) break;
      }
      // RSVP snapshots carry no email; join it from the member list (organizers may read it).
      const people = new Map((await listMembersAll(session).catch(() => [] as Member[])).map((m) => [m.id, m]));
      return docs.map((d): Attendee => {
        const id = str(d.get("userId")) || d.id;
        return {
          memberId: id, name: str(d.get("userName")), email: people.get(id)?.email ?? "", photoURL: people.get(id)?.photoURL || undefined, avatarId: people.get(id)?.avatarId || str(d.get("userAvatarId")) || undefined, department: str(d.get("userDepartment")),
          jobTitle: str(d.get("userJobTitle")), rsvpAt: iso(d.get("createdAt")), checkedIn: d.get("checkedIn") === true, addedByAdmin: d.get("source") === "admin",
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
    }),
    addAttendee: (input) => run(async () => {
      const data = await call<{ attendeeCount: number; capacity: number }>(ADMIN_CALLABLES.addAttendee, await organizer(), {
        eventId: input.eventId, userId: input.memberId, requestId: input.requestId, notify: input.notify,
        ...(input.capacityOverrideReason ? { capacityOverrideReason: input.capacityOverrideReason } : {}),
      });
      return { attendeeCount: Number(data.attendeeCount ?? 0), capacity: Number(data.capacity ?? 0) };
    }),
    removeAttendee: (eventId, memberId, notify, reason) => run(async () => {
      const data = await call<{ attendeeCount: number }>(ADMIN_CALLABLES.removeAttendee, await organizer(), { eventId, userId: memberId, notify, ...(reason ? { reason } : {}) });
      return { attendeeCount: Number(data.attendeeCount ?? 0) };
    }),
    // recordAttendanceV1 has no requestId: it converges on state.
    recordAttendance: (eventId, memberId, checkedIn) => run(async () => {
      const data = await call<{ pointsAwarded: number; checkedIn: boolean }>(ADMIN_CALLABLES.recordAttendance, await organizer(), { eventId, userId: memberId, checkedIn }, false);
      return { pointsAwarded: Number(data.pointsAwarded ?? 0), checkedIn: data.checkedIn === true };
    }),

    listMembers: () => run(async () => listMembersAll(await organizer())),
    listMembersPage: (q: MemberQuery, cursor, pageSize = 25) => run(async () => {
      const data = await call<{ members: DocumentData[]; nextPageToken?: string; total?: number }>(ADMIN_CALLABLES.listMembers, await organizer(), {
        pageSize,
        ...(q.query.trim() ? { query: q.query.trim().slice(0, 80) } : {}), ...(q.status !== "all" ? { status: q.status } : {}), ...(q.role !== "all" ? { role: q.role } : {}),
        ...(q.teamId !== "all" && q.teamId ? { teamId: q.teamId } : {}), ...(q.workLocation !== "all" && q.workLocation ? { workLocation: q.workLocation } : {}),
        ...(cursor ? { pageToken: cursor } : {}),
      }, false);
      return { members: data.members.map(memberFromSummary), nextCursor: data.nextPageToken ?? null, total: typeof data.total === "number" ? data.total : null };
    }),
    getMember: (id) => run(async () => member(await organizer(), id)),
    updateMember: (id, expectedRevision, patch) => run(async () => {
      const session = await organizer();
      await call(ADMIN_CALLABLES.updateMember, session, { userId: id, expectedRevision, ...patch });
      return member(session, id);
    }),
    setMemberStatus: (id, status, reason) => run(async () => {
      const session = await organizer();
      await call(ADMIN_CALLABLES.setMemberStatus, session, { userId: id, status, reason });
      return member(session, id);
    }),
    resetMemberProfile: (id, reason) => run(async () => {
      const session = await organizer();
      await call(ADMIN_CALLABLES.resetMemberProfile, session, { userId: id, reason });
      return member(session, id);
    }),
    adjustPoints: (id, requestId, delta, reason) => run(async () => {
      const session = await organizer();
      await call(ADMIN_CALLABLES.adjustPoints, session, { userId: id, requestId, delta, reason });
      return member(session, id);
    }),

    // The roster lists everyone (invited, joined, deactivated, revoked); listRosterV1 pages and searches on the server.
    listRosterPage: (q, cursor, pageSize = 25) => run(async () => {
      const data = await call<{ entries: DocumentData[]; nextPageToken?: string; counts?: RosterCounts }>(ADMIN_CALLABLES.listRoster, await organizer(), {
        pageSize, ...(q.query.trim() ? { query: q.query.trim().slice(0, 80) } : {}), ...(q.state !== "all" ? { state: q.state } : {}), ...(cursor ? { pageToken: cursor } : {}),
      }, false);
      return { rows: data.entries.map((e) => rosterFromDoc(str(e.id), e)), nextCursor: data.nextPageToken ?? null, counts: data.counts ?? null };
    }),
    resendInvite: (row) => run(async () => {
      const data = await call<{ resendCount: number; lastResentAt: string; signInUrl: string; message: string }>(ADMIN_CALLABLES.resendRosterInvite, await organizer(), { entryId: row.entryId });
      return { resendCount: Number(data.resendCount ?? 0), lastResentAt: iso(data.lastResentAt), signInUrl: str(data.signInUrl), message: str(data.message) };
    }),
    backfillRoster: (dryRun, requestId, cursor) => run(async () => {
      const data = await call<BackfillStep & { nextPageToken?: string }>(ADMIN_CALLABLES.backfillRoster, await organizer(), { dryRun, requestId, ...(cursor ? { pageToken: cursor } : {}) });
      return { dryRun: data.dryRun === true, scanned: Number(data.scanned ?? 0), created: Number(data.created ?? 0), existing: Number(data.existing ?? 0), skipped: Number(data.skipped ?? 0), nextCursor: data.nextPageToken ?? null, done: data.done === true };
    }),
    getImport: (jobId) => run(async () => {
      const data = await call<{ job: DocumentData }>(ADMIN_CALLABLES.getImport, await organizer(), { jobId }, false);
      const job = data.job;
      return {
        jobId, status: (str(job.status) || "planned") as ImportJobInfo["status"], chunkCount: Number(job.chunkCount ?? 0), nextChunk: Number(job.nextChunk ?? 0),
        progress: job.progress as ImportJobInfo["progress"], planHash: str(job.planHash), fileName: str(job.fileName),
      } satisfies ImportJobInfo;
    }),
    revokeRosterEntry: (entryId) => run(async () => {
      await call(ADMIN_CALLABLES.revokeRosterEntry, await organizer(), { entryId });
    }),
    reinvite: (row) => run(async () => {
      await call(ADMIN_CALLABLES.upsertRosterEntry, await organizer(), {
        entry: employeeInput({ ...row, role: row.role, teams: row.teamIds }),
      });
    }),
    planImport: (request) => run(async () => {
      const data = await call<Omit<ImportPlanResponse, "rows"> & { rows: ImportPlanResponse["rows"] }>(ADMIN_CALLABLES.planImport, await organizer(), {
        requestId: request.requestId, fileName: request.fileName.slice(0, 200), rows: request.rows.map(employeeInput),
      });
      return {
        jobId: data.jobId, planHash: data.planHash, chunkCount: data.chunkCount,
        rows: data.rows.map((r) => ({
          ...r, changes: (r.changes ?? []).map((c) => ({ field: c.field, before: c.before ?? "", after: c.after ?? "" })),
        })),
      };
    }),
    applyImportStep: (jobId, planHash) => run(async () => {
      const data = await call<ApplyStepResponse>(ADMIN_CALLABLES.applyImport, await organizer(), { jobId, planHash }, false);
      return { status: data.status, done: data.done === true, progress: data.progress, results: data.results ?? [] };
    }),

    listSubmissions: (challengeId, status, cursor) => run(async () => {
      const data = await call<{ submissions: DocumentData[]; nextCursor: string | null }>(
        ADMIN_CALLABLES.listSubmissions, await organizer(), { challengeId, status, limit: 25, ...(cursor ? { cursor } : {}) }, false);
      return { submissions: data.submissions.map(submissionFromWire), nextCursor: data.nextCursor ?? null };
    }),
    // Evidence has no download URL: admins read the object through the authenticated Storage SDK (storage rules).
    submissionEvidence: (submission) => run(async () => {
      if (!submission.storagePath) throw new Error("This submission has no photo.");
      return URL.createObjectURL(await getBlob(ref(getStorage(app), submission.storagePath)));
    }),
    // Always send the listed updatedAt so the review fails (SUBMISSION_CHANGED) if the member edited since.
    approveSubmission: (submission) => run(async () => {
      const data = await call<{ pointsAwarded: number; replayed?: boolean }>(ADMIN_CALLABLES.approveSubmission, await organizer(), {
        challengeId: submission.challengeId, userId: submission.userId, expectedUpdatedAt: submission.updatedAt,
      }, false);
      return { pointsAwarded: Number(data.pointsAwarded ?? 0), replayed: data.replayed === true };
    }),
    rejectSubmission: (submission, reason) => run(async () => {
      const data = await call<{ replayed?: boolean }>(ADMIN_CALLABLES.rejectSubmission, await organizer(), {
        challengeId: submission.challengeId, userId: submission.userId, reason: reason.trim(), expectedUpdatedAt: submission.updatedAt,
      }, false);
      return { replayed: data.replayed === true };
    }),

    listBugReports: (q, cursor, pageSize = 25) => run(async () => {
      const data = await call<{ reports: DocumentData[]; nextPageToken?: string; counts?: BugReportCounts }>(ADMIN_CALLABLES.listBugReports, await organizer(), {
        pageSize, ...(q.query.trim() ? { query: q.query.trim().slice(0, 80) } : {}), ...(q.status !== "all" ? { status: q.status } : {}), ...(q.category !== "all" ? { category: q.category } : {}),
        ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}), ...(cursor ? { pageToken: cursor } : {}),
      }, false);
      return { reports: data.reports.map(bugReportFromWire), nextCursor: data.nextPageToken ?? null, counts: data.counts ?? null };
    }),
    getBugReport: (reportId) => run(async () => {
      const d = await call<DocumentData>(ADMIN_CALLABLES.getBugReport, await organizer(), { reportId }, false);
      return {
        report: bugReportFromWire(d.report as DocumentData), reporterEmail: str(d.reporterEmail), diagnostics: (d.diagnostics as BugDiagnostics | undefined) ?? null,
        screenshotUrl: str(d.screenshotUrl) || null, note: str(d.note), revision: Number(d.revision ?? 0), updatedAt: iso(d.updatedAt) || null, updatedByName: str(d.updatedByName) || null,
      };
    }),
    updateBugReport: (reportId, patch, expectedRevision) => run(async () => {
      const d = await call<DocumentData>(ADMIN_CALLABLES.updateBugReport, await organizer(), { reportId, ...patch, expectedRevision });
      return {
        status: bugStatus(d.status), note: str(d.note), assigneeId: str(d.assigneeId) || null, assigneeName: str(d.assigneeName) || null,
        revision: Number(d.revision ?? 0), updatedAt: iso(d.updatedAt), changed: d.changed === true,
      };
    }),

    companyInsights: (refresh = false) => run(async () => {
      const session = await organizer();
      return insightsFromWire(await call<DocumentData>(ADMIN_CALLABLES.getInsights, session, refresh ? { refresh: true } : {}, false));
    }),

    // Organizer and admin read; the rules cap list queries at 200. A denial means "no stats": counts stay hidden.
    tagStats: () => run(async () => {
      const session = await organizer();
      try {
        const snap = await getDocs(query(col(session, "tagStats"), limit(200)));
        return snap.docs.map((d) => tagStatFromDoc(d.id, d.data()));
      } catch (failure) {
        if ((failure as { code?: string } | null)?.code === "permission-denied") return null;
        throw failure;
      }
    }),

    eventIdeaContext: () => run(async () => {
      const session = await organizer();
      return ideaContextFromWire(await call<DocumentData>(ADMIN_CALLABLES.eventIdeaContext, session, {}, false));
    }),
    eventIdeaSuggestions: (input) => run(async () => {
      const session = await organizer();
      // A plain visit sends no model-spending flag: the server answers from the saved company suggestions.
      const payload = input?.refresh ? { requestId: input.requestId ?? crypto.randomUUID(), refresh: true } : {};
      return suggestionsFromWire(await call<DocumentData>(ADMIN_CALLABLES.eventIdeaSuggestions, session, payload, false));
    }),
    pickEventCover: (input) => run(async () => {
      const session = await organizer();
      const data = await call<DocumentData>(ADMIN_CALLABLES.pickEventCover, session, {
        requestId: crypto.randomUUID(), title: input.title, description: input.description, tagIds: input.tagIds,
        theme: input.theme, excludeCoverImageURLs: input.excludeCoverImageURLs,
      });
      return {
        coverImageURL: String(data.coverImageURL ?? ""),
        source: data.source === "dipbot" || data.source === "match" ? data.source : "default",
        provider: data.provider === "jev" || data.provider === "openai" || data.provider === "heuristic" ? data.provider : null,
        alternatives: Array.isArray(data.alternatives) ? data.alternatives.map(String) : [],
        ...(data.newPhoto === true ? { newPhoto: true } : {}),
        ...(typeof data.coverAlt === "string" && data.coverAlt.trim() ? { coverAlt: data.coverAlt.trim().slice(0, 160) } : {}),
      };
    }),
    searchCoverPhotos: (query) => run(async () => {
      const session = await organizer();
      const data = await call<DocumentData>(ADMIN_CALLABLES.searchCoverPhotos, session, { requestId: crypto.randomUUID(), query: query.trim().slice(0, 60) }, false);
      const status = data.status === "rate_limited" || data.status === "quota" || data.status === "ok" ? data.status : "unavailable";
      const candidates = Array.isArray(data.candidates) ? data.candidates.flatMap((c: DocumentData) => (
        typeof c?.key === "string" && typeof c.previewURL === "string" && c.previewURL.startsWith("https://pixabay.com/")
          ? [{ key: c.key, previewURL: c.previewURL, tags: Array.isArray(c.tags) ? c.tags.map(String).slice(0, 8) : [], width: Number(c.width) || 0, height: Number(c.height) || 0, stored: c.stored === true }]
          : []
      )) : [];
      return { candidates, status };
    }),
    importCoverPhoto: (key) => run(async () => {
      const session = await organizer();
      const data = await call<DocumentData>(ADMIN_CALLABLES.importCoverPhoto, session, { requestId: crypto.randomUUID(), key }, false);
      return { coverImageURL: String(data.coverImageURL ?? ""), coverAlt: typeof data.coverAlt === "string" ? data.coverAlt.trim().slice(0, 160) : "", newPhoto: data.newPhoto === true };
    }),
    // The caller owns the requestId (one per attempt), so `call` sends it as given.
    generateEventDrafts: (input) => run(async () => {
      const session = await organizer();
      return draftsFromWire(await call<DocumentData>(ADMIN_CALLABLES.generateEventDrafts, session, {
        requestId: input.requestId, choices: input.choices, prompt: input.prompt, count: input.count,
        ...(input.considerations && input.considerations.length > 0 ? { considerations: input.considerations } : {}),
      }));
    }),

    listAudit: () => run(async () => {
      const session = await organizer();
      const snap = await getDocs(query(col(session, "auditLog"), orderBy("createdAt", "desc"), limit(100)));
      return snap.docs.map((d) => auditFromDoc(d.id, d.data()));
    }),
  };
}
