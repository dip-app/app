import { asset } from "./asset";
import type { AdminOpsApi } from "./adminApi";
import { MAX_INVITE_EMAILS, MAX_RESENDS, inviteMessage } from "./inviteMessage";
import {
  type AlbumComment, type AlbumPhoto, type ApplyRowResult, type Attendee, type AuditEntry, type Capability, type CompanyInfo,
  type DipbotIdeas, type SuggestThemeResult, type EventIdeaContext, type EventIdeaSuggestions, type GenerateDraftsResult, type BackfillStep, type BugCategory, type BugDiagnostics, type BugReport, type BugReportCounts, type BugStatus, type FieldChange, type ImportJobInfo, type ImportPlanResponse, type ImportRow, type Member, type MemberQuery, type PlanAction, type Role, type RosterCounts, type RosterQuery, type RosterRow, type Submission,
  type EmailSwitches, IMPORT_FIELDS, IMPORT_LIMITS, can, emailSwitchesFrom,
} from "./adminTypes";
import type { KeyValueStore, Session } from "./api";
import { t } from "./aiStrings";
import { ApiError } from "./contract";
import { validateRow } from "./importFile";
import { mockTagStats } from "./tagStatsMock";
import { bundledTagId, previewTagId } from "./catalog";
import { type ImportCoverPhotoResult, type PickEventCoverResult, type SearchCoverPhotosResult, lexicalPick } from "./covers";
import { rankConsiderationsByRules } from "./considerations";
import { fakeAutocomplete, fakeResolve } from "./location/fake";
import { MOCK_OFFICE, mockVenues } from "./venuesMock";
import type { CompanyOffice } from "./venues";
import { buildMockInsights, scenarioFromSearch } from "./insightsMock";
import {
  MOCK_CREDITS_USED, MOCK_CREDIT_ALLOWANCE, MOCK_CREDIT_COSTS, MOCK_DAILY_LIMIT, MOCK_MONTHLY_LIMIT, cacheScenarioFromSearch, creditsOf, aiScenarioFromSearch, buildMockDrafts, mockIdeaContext, mockSuggestions, promptRejected, suggestScenarioFromSearch, usageOf,
} from "./ideasMock";
import { buildMockIdeas, ideasScenarioFromSearch } from "./ideasForYouMock";
import { buildMockThemeSuggestions, themeSuggestScenarioFromSearch } from "./themeSuggestMock";

/** What the ops mock needs to know about an event; supplied by createMockApi so counts stay consistent. */
export interface MockEventView {
  id: string; title: string; capacity: number; attendeeCount: number; startTime: string; endTime: string; status: string; pointsValue: number;
}
export interface MockOpsDeps {
  store: KeyValueStore;
  now: () => Date;
  session: () => Session | null;
  findEvent: (companyId: string, eventId: string) => MockEventView | undefined;
  /** Changes the going count; `minCapacity` grows the capacity (the capacity-override rule). */
  bumpAttendees: (companyId: string, eventId: string, delta: number, minCapacity?: number) => { attendeeCount: number; capacity: number };
  /** The company's weekly themes (challenges) the review queue belongs to. */
  themes: (companyId: string) => { id: string; title: string; coverImageURL?: string; pointsReward: number; startDate: string; endDate: string; participantCount: number; completedCount: number }[];
  /** The company's events (Overview numbers). */
  events: (companyId: string) => MockEventView[];
}

type Stored<T> = T & { companyId: string };
type StoredMember = Stored<Omit<Member, "pointsBalance"> & { pointsBalance: number }>;
type StoredRoster = Stored<RosterRow>;
interface PlanInternal { rowNumber: number; email: string; action: PlanAction; target: "member" | "roster" | "none"; changes: FieldChange[]; errors: { code: string; message: string }[] }
interface Job {
  companyId: string; planHash: string; rows: ImportRow[]; plans: PlanInternal[]; nextChunk: number; chunkCount: number;
  results: ApplyRowResult[]; status: "planned" | "running" | "completed" | "completed_with_errors";
}
interface OpsState {
  /** Invitation email is on for the demo company unless set to false (listRosterV1 `inviteEmail`). */
  inviteEmail?: boolean;
  companies: Record<string, CompanyInfo>;
  members: StoredMember[];
  roster: StoredRoster[];
  photos: Stored<AlbumPhoto>[];
  comments: Stored<AlbumComment & { eventId: string }>[];
  attendees: Record<string, Attendee[]>; // `${companyId}:${eventId}`
  audit: Stored<AuditEntry>[];
  receipts: Record<string, string>;
  jobs: Record<string, Job>;
  /** Added after the first release; created on first use so stored preview data keeps working. */
  submissions?: Stored<Submission & { changeOnReview?: boolean }>[];
  seededThemes?: string[];
  bugReports?: StoredBug[];
  /** Opt-in email switches per uid (Your settings); missing means off, like the server default. */
  emailSwitches?: Record<string, Partial<EmailSwitches>>;
}

interface StoredBug extends BugReport {
  companyId: string; reporterEmail: string; diagnostics: BugDiagnostics | null; screenshot: string | null; note: string; revision: number;
  updatedAt: string | null; updatedByName: string | null;
}

const KEY = "dip-admin-mock-ops-v4";
const AI_KEY = "dip-admin-mock-ai-v1";
const OFFICE_KEY = "dip-admin-mock-office-v1";
/** Preview usage: some of the quota is already spent so the meter has something to show. */
interface AiState { usage: Record<string, { monthly: number; daily: number }>; receipts: Record<string, GenerateDraftsResult>; credits?: Record<string, number>; venueRequests?: string[] }
const TEAMS = ["Platform", "Mentors", "Wellness", "Events crew", "Design"];
const LOCATIONS = ["Pittsburgh", "Philadelphia", "New York", "Remote"];
const DEPARTMENTS = ["Engineering", "People", "Marketing", "Finance", "Operations"];
const FIRST = ["Alex", "Pat", "Casey", "Riley", "Sam", "Jordan", "Morgan", "Taylor", "Avery", "Quinn", "Jamie", "Robin", "Drew", "Skyler", "Cameron", "Reese", "Emery", "Harper", "Rowan", "Sage", "Blake", "Dana", "Kai", "Lee", "Noor", "Ola", "Pia", "Quin", "Remy", "Tess"];
const LAST = ["Admin", "Member", "Novak", "Chen", "Okafor", "Rivera", "Patel", "Haas", "Kim", "Silva", "Brandt", "Costa", "Dubois", "Evans", "Fischer", "Gupta", "Hughes", "Ito", "Jensen", "Khan", "Lopez", "Mendes", "Nair", "Ortiz", "Park", "Quill", "Roth", "Stone", "Tran", "Ueda"];

const MOCK_PHOTOS: Record<number, string> = { 0: "/img/mock-photos/p1.svg", 1: "/img/mock-photos/p2.svg", 2: "/img/mock-photos/p3.svg", 6: "/img/mock-photos/p4.svg", 9: "/img/mock-photos/p5.svg" };
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const isoAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
/** The stored photo and avatar id a person list carries (empty ones are left out, as the live adapter does). */
const profileOf = (m: { photoURL?: string; avatarId?: string }) => ({ ...(m.photoURL ? { photoURL: m.photoURL } : {}), ...(m.avatarId ? { avatarId: m.avatarId } : {}) });

export function seedOps(now: Date): OpsState {
  const teams = TEAMS.map((name) => ({ id: `team-${slug(name)}`, name }));
  const companies: Record<string, CompanyInfo> = {
    acme: { id: "acme", name: "Acme", emailDomain: "acme.com", teams },
    globex: { id: "globex", name: "Globex", emailDomain: "globex.com", teams },
  };
  const members: StoredMember[] = FIRST.map((first, i) => {
    const last = LAST[i];
    const role: Role = i === 0 ? "admin" : i === 2 ? "organizer" : "member";
    const email = i === 0 ? "alex@acme.com" : i === 1 ? "pat@acme.com" : `${slug(first)}.${slug(last)}@acme.com`;
    return {
      companyId: "acme", id: i === 0 ? "uid-admin" : i === 1 ? "uid-member" : i === 2 ? "uid-casey-novak" : `uid-${slug(first)}-${slug(last)}`, email,
      displayName: `${first} ${last}`, role, teamIds: [teams[i % 5].id, ...(i % 4 === 0 ? [teams[(i + 2) % 5].id] : [])],
      workLocation: LOCATIONS[i % 4], department: DEPARTMENTS[i % 5], jobTitle: i % 3 === 0 ? "Manager" : "Specialist",
      status: i === 20 ? "deactivated" : "active", pointsBalance: (i * 137) % 900, createdAt: isoAgo(now, 200 - i * 6),
      avatarId: i % 3 === 0 ? `avatar-${(i % 8) + 1}` : "", city: LOCATIONS[i % 4], revision: 1,
      // A few members have a Google photo (local art here so screenshots need no network); most have neither photo nor avatar, like real accounts (they show the generated character).
      photoURL: MOCK_PHOTOS[i] ?? "",
    };
  });
  members.push({
    companyId: "globex", id: "uid-other-admin", email: "gale@globex.com", displayName: "Gale Globex", role: "admin", teamIds: [],
    workLocation: "Remote", department: "Operations", jobTitle: "Director", status: "active", pointsBalance: 0, createdAt: isoAgo(now, 90),
    avatarId: "avatar-1", photoURL: "", city: "Remote", revision: 1,
  });
  const invite = (first: string, last: string, days: number, teamIndex: number): StoredRoster => ({
    companyId: "acme", entryId: `${slug(first)}.${slug(last)}@acme.com`, email: `${slug(first)}.${slug(last)}@acme.com`, displayName: `${first} ${last}`, role: "member",
    teamIds: [teams[teamIndex].id], workLocation: LOCATIONS[teamIndex % 4], department: DEPARTMENTS[teamIndex % 5], jobTitle: "Specialist",
    managerEmail: "", startDate: "", state: "invited", invitedAt: isoAgo(now, days),
  });
  // Everyone who signed in has a claimed entry, except the last five: they joined before the roster listed everyone (the backfill adds them).
  const claimed = members.filter((m) => m.companyId === "acme").slice(0, -5).map((m): StoredRoster => ({
    companyId: "acme", entryId: m.email, email: m.email, displayName: m.displayName, role: m.role, teamIds: m.teamIds, workLocation: m.workLocation, department: m.department,
    jobTitle: m.jobTitle, managerEmail: "", startDate: "", state: "active", memberId: m.id, invitedAt: m.createdAt, ...profileOf(m),
  }));
  const roster: StoredRoster[] = [...claimed, invite("Nico", "Farrow", 12, 0), invite("Priya", "Shah", 5, 2), invite("Tomas", "Reyes", 2, 4), { ...invite("Lena", "Marsh", 30, 1), state: "revoked" }];
  const photos: Stored<AlbumPhoto>[] = [];
  const comments: Stored<AlbumComment & { eventId: string }>[] = [];
  const images = ["games", "cooking", "outdoors", "fitness", "hiking"];
  for (let i = 0; i < 9; i += 1) {
    const uploader = members[(i * 3 + 1) % 20];
    const id = `${uploader.id}_${i}`;
    const count = i % 3;
    photos.push({
      companyId: "acme", id, eventId: "game-cafe", uploaderId: uploader.id, uploaderName: uploader.displayName,
      caption: i % 2 ? "" : "Best table of the night", commentCount: count, createdAt: isoAgo(now, 13 - i * 0.3),
      storagePath: `companies/acme/events/game-cafe/photos/${uploader.id}/${i}`, previewImage: asset(`/img/events/${images[i % 5]}.jpg`),
    });
    for (let c = 0; c < count; c += 1) {
      const author = members[(i + c * 5 + 2) % 20];
      comments.push({
        companyId: "acme", eventId: "game-cafe", id: `c-${i}-${c}`, photoId: id, authorId: author.id, authorName: author.displayName,
        text: c ? "We should do this again next month." : "Love this one!", createdAt: isoAgo(now, 12.8 - i * 0.3 - c * 0.1),
      });
    }
  }
  // Older audit history so the Audit log is not empty on first load (newer entries come from actions taken in the session).
  const who = (i: number) => ({ actorId: members[i].id, actorName: members[i].displayName, actorRole: members[i].role });
  const hist = (n: number, hours: number, actor: number, e: Omit<AuditEntry, "id" | "at" | "actorId" | "actorName" | "actorRole" | "changes"> & { changes?: AuditEntry["changes"] }): Stored<AuditEntry> =>
    ({ changes: [], ...e, ...who(actor), companyId: "acme", id: `aud-seed-${n}`, at: new Date(now.getTime() - hours * 3_600_000).toISOString() });
  const audit: Stored<AuditEntry>[] = [
    hist(1, 2, 0, { action: "ai.generateDrafts", targetType: "company", targetId: "acme", summary: "Generated 3 AI event drafts", changes: [
      { field: "models", before: "", after: "gpt-5-mini" }, { field: "tokens", before: "", after: "1840 in, 1210 out" }, { field: "credits", before: "", after: "10" }] }),
    hist(2, 5, 2, { action: "ai.noteDeclined", targetType: "company", targetId: "acme", summary: "AI note declined by the safety check", changes: [
      { field: "credits", before: "", after: "0" }, { field: "flaggedCategories", before: "", after: "harassment" }] }),
    hist(3, 20, 0, { action: "suggestions.setSchedule", targetType: "company", targetId: "acme", summary: "Changed the weekly ideas email schedule", changes: [
      { field: "weekday", before: "1", after: "3" }, { field: "hour", before: "8", after: "9" }] }),
    hist(4, 26, 0, { action: "roster.upsert", targetType: "roster", targetId: "nico.farrow@acme.com", summary: "Invited Nico Farrow", changes: [{ field: "role", before: "", after: "member" }] }),
    hist(5, 30, 0, { action: "attendee.add", targetType: "attendee", targetId: "game-cafe/uid-member", summary: "Added Morgan Lee to Game Cafe" }),
    hist(6, 50, 2, { action: "attendance.record", targetType: "attendee", targetId: "game-cafe/uid-member", summary: "Marked Morgan Lee as attended" }),
    hist(7, 73, 0, { action: "member.update", targetType: "member", targetId: "uid-member", summary: "Changed role", reason: "Now leads the events team", changes: [{ field: "role", before: "member", after: "organizer" }] }),
    hist(8, 96, 0, { action: "import.apply", targetType: "import", targetId: "job-1", summary: "Imported 12 people (9 created, 3 updated)" }),
    hist(9, 120, 2, { action: "photo.remove", targetType: "photo", targetId: "game-cafe/uid-casey-novak_4", summary: "Removed an event photo", reason: "Photo showed a customer's screen" }),
  ];
  return { companies, members, roster, photos, comments, attendees: {}, audit, receipts: {}, jobs: {} };
}

const hashOf = (value: unknown) => {
  // A stand-in for the server's SHA-256 plan hash: stable for equal rows, 64 hex characters.
  const text = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8);
};


const BUG_SEEDS: { cat: BugCategory; text: string; screen: string; shot?: string; status?: BugStatus; note?: string; assignee?: string; source?: "shake" | "profile" }[] = [
  { cat: "bug", text: "I tapped Join on the Game Cafe event and the button just kept spinning. Had to force close the app, and then it showed me as not going.", screen: "event", shot: "games" },
  { cat: "looksWrong", text: "The points on the Rewards tab are cut off on my phone, the last digit is hidden behind the badge.", screen: "rewards", shot: "fitness" },
  { cat: "confusing", text: "I can't tell how to change my teams. Is that something I do or does an admin do it?", screen: "profile", source: "profile" },
  { cat: "idea", text: "It would be great to filter events by office so I only see the ones in Pittsburgh.", screen: "home", status: "triaged", note: "Related to the location filter on the roadmap. Waiting for the V2 filters design.", assignee: "uid-admin" },
  { cat: "bug", text: "Photo upload failed twice on the cooking class album. Third time worked but now there are two copies of the same picture.", screen: "album", shot: "cooking", status: "triaged", note: "Duplicate uploads: check the retry path of finalizeEventPhotoV1.", assignee: "uid-admin" },
  { cat: "unspecified", text: "Something looked off on the participants list, names were overlapping with the avatar.", screen: "participants", shot: "outdoors" },
  { cat: "bug", text: "Notification said the hike starts at 9 but the event page says 10.", screen: "event", status: "resolved", note: "Time zone bug in the reminder. Fixed in 2.1 (build 418)." },
  { cat: "looksWrong", text: "Dark mode: the challenge card has white text on a light background.", screen: "challenge", shot: "hiking" },
  { cat: "idea", text: "Let me add a plus one to an event.", screen: "event" },
  { cat: "confusing", text: "What does 'Check in' do? I pressed it by accident.", screen: "myEvents", status: "resolved", note: "Explained in the help text, closing." },
  { cat: "bug", text: "App crashed when I opened My Events right after signing in.", screen: "myEvents" },
  { cat: "idea", text: "Weekly theme reminders on Monday morning would help me remember.", screen: "challenge", source: "profile" },
  { cat: "bug", text: "I can't see my friend's photos in the album even though they were published yesterday.", screen: "album", shot: "games" },
  { cat: "looksWrong", text: "Profile picture is stretched on the Home screen header.", screen: "home" },
];

/** Bug reports are seeded when the inbox is first opened so older stored preview data keeps working. */
function seedBugReports(state: OpsState, now: Date): void {
  const people = state.members.filter((m) => m.companyId === "acme" && m.role === "member" && m.status === "active");
  const admins = state.members.filter((m) => m.companyId === "acme" && m.role === "admin");
  const phones = [["iPhone17,1", "iOS 18.1"], ["iPhone16,2", "iOS 18.0.1"], ["iPhone15,4", "iOS 17.6"]];
  const out: StoredBug[] = BUG_SEEDS.map((s, i) => {
    const who = people[(i * 3 + 1) % people.length];
    const [model, os] = phones[i % 3];
    const assignee = s.assignee ? admins.find((a) => a.id === s.assignee) : undefined;
    return {
      companyId: "acme", id: `7f3c2a1${i.toString(16)}-0b5d-4c3e-9a41-${String(1000 + i * 37).padStart(12, "0")}`, category: s.cat, description: s.text, source: s.source ?? "shake", screen: s.screen,
      createdAt: isoAgo(now, 0.05 + i * 0.6), reporterId: who.id, reporterName: who.displayName, ...(who.photoURL ? { reporterPhotoURL: who.photoURL } : {}), ...(who.avatarId ? { reporterAvatarId: who.avatarId } : {}), appVersion: i % 5 === 4 ? "2.0" : "2.1", hasScreenshot: !!s.shot, status: s.status ?? "new", hasNote: !!s.note,
      ...(assignee ? { assigneeId: assignee.id, assigneeName: assignee.displayName } : {}),
      reporterEmail: who.email, screenshot: s.shot ? asset(`/img/events/${s.shot}.jpg`) : null, note: s.note ?? "", revision: s.status || s.note ? 1 : 0,
      updatedAt: s.status ? isoAgo(now, 0.2 + i * 0.3) : null, updatedByName: s.status ? "Alex Admin" : null,
      diagnostics: { appVersion: i % 5 === 4 ? "2.0" : "2.1", appBuild: i % 5 === 4 ? "398" : "418", osVersion: os, deviceModel: model, locale: "en_US", screen: s.screen, installId: `0a1b2c3d-1111-2222-3333-4444555566${String(10 + i)}` },
    };
  });
  out.push({
    companyId: "globex", id: "5b1e0000-0000-4000-8000-000000000001", category: "bug", description: "Globex only: this must never show in Acme's inbox.", source: "shake", screen: "home", createdAt: isoAgo(now, 0.1),
    reporterId: "uid-other-admin", reporterName: "Gale Globex", hasScreenshot: false, status: "new", hasNote: false, reporterEmail: "gale@globex.com", diagnostics: null, screenshot: null, note: "", revision: 0, updatedAt: null, updatedByName: null,
  });
  state.bugReports = out;
}

const SUBMISSION_PAGE = 25;
const BUG_PAGE = 25;
const NOTES = [
  "Did the 30 minute run before work.", "Yoga at lunch, three sessions this week.", "Walked the stairs instead of the elevator all week. My legs hurt but it counts!",
  "Cycled to the office on Tuesday and Thursday, plus a long ride on Saturday with the family, about 40 km in total.", "", "Swim session at the community pool.",
  "Gym class with the Wellness team.", "Morning stretch routine, every day.",
];

/** Seeds a believable review queue for a theme the first time it is opened. */
function seedSubmissions(state: OpsState, companyId: string, theme: { id: string; startDate: string }, now: Date): void {
  const people = state.members.filter((m) => m.companyId === companyId && m.status === "active" && m.role !== "admin");
  const count = Math.min(people.length, theme.startDate > now.toISOString() ? 0 : 22);
  people.slice(0, count).forEach((m, i) => {
    const kind = i % 7 === 4 ? "rejected" : i % 7 >= 5 ? "approved" : "submitted";
    const at = isoAgo(now, 3 - (i % 3) * 0.7 - i * 0.03);
    state.submissions!.push({
      companyId, id: `${theme.id}_${m.id}`, challengeId: theme.id, userId: m.id, userName: m.displayName, ...profileOf(m), caption: NOTES[i % NOTES.length], progress: 1 + (i % 3),
      status: kind, createdAt: at, updatedAt: at, storagePath: i % 8 === 4 ? null : `companies/${companyId}/challenges/${theme.id}/submissions/${m.id}/0`,
      attempt: i % 9 === 2 ? 2 : 1, reviewedAt: kind === "submitted" ? null : isoAgo(now, 1), reviewNote: kind === "rejected" ? "The photo is too dark to see the activity. Please add a clearer one." : null,
      pointsAwarded: kind === "approved" ? 50 : 0,
      // Demo of "changed meanwhile": the member edits this entry the first time you try to review it.
      ...(i === 1 ? { changeOnReview: true } : {}),
    });
  });
}

export function createMockOps(deps: MockOpsDeps): AdminOpsApi {
  const { store, now } = deps;
  function load(): OpsState {
    const raw = store.getItem(KEY);
    if (raw) {
      try { return JSON.parse(raw) as OpsState; } catch { /* reseed below */ }
    }
    const fresh = seedOps(now());
    store.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  }
  const save = (state: OpsState) => store.setItem(KEY, JSON.stringify(state));
  function aiLoad(): AiState {
    const raw = store.getItem(AI_KEY);
    if (raw) { try { return JSON.parse(raw) as AiState; } catch { /* start fresh */ } }
    return { usage: {}, receipts: {} };
  }
  /** `?tags=opaque` preview: drafts carry opaque tag IDs like production. */
  const previewDrafts = (result: GenerateDraftsResult): GenerateDraftsResult => ({ ...result, drafts: result.drafts.map((d) => ({ ...d, tagIds: d.tagIds.map(previewTagId) })) });
  const aiSave = (state: AiState) => store.setItem(AI_KEY, JSON.stringify(state));
  const aiUsage = (companyId: string) => aiLoad().usage[companyId] ?? { monthly: 12, daily: 3 };
  /** Credits spent this month: the scenario can force the low and out states for design review. */
  const aiCreditsUsed = (companyId: string) => {
    const scenario = aiScenario();
    if (scenario === "nocredits" || (typeof window !== "undefined" && ideasScenarioFromSearch(window.location.search) === "exhausted")) return MOCK_CREDIT_ALLOWANCE;
    if (scenario === "lowcredits") return MOCK_CREDIT_ALLOWANCE - 60;
    return aiLoad().credits?.[companyId] ?? MOCK_CREDITS_USED;
  };
  /** The mock's saved company suggestions after a first visit or refresh in this page load (a reload starts from `?cache=`). */
  const savedSuggest: { at: number | null } = { at: null };
  /** "Ideas for you" in this page load: runs so far, refreshes used today and the stored answers by requestId. */
  const ideasRun: { at: number | null; generation: number; refreshes: number; autoDone: boolean; receipts: Map<string, DipbotIdeas> } = { at: null, generation: 0, refreshes: 0, autoDone: false, receipts: new Map() };
  const aiScenario = () => (typeof window === "undefined" ? "default" as const : aiScenarioFromSearch(window.location.search));
  /** Suggest theme in this page load: presses so far and the answers by requestId (a replay is free). */
  const themeRuns: { generation: number; receipts: Map<string, SuggestThemeResult> } = { generation: 0, receipts: new Map() };
  /** `?places=disabled|limit|notfound` preview scenarios: disabled and limit make every Places call fail like the server does. */
  const placesScenario = (): string | null => {
    const value = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("places");
    if (value === "disabled") throw new ApiError("failed-precondition", "Address search is not set up.", {}, "PLACES_DISABLED");
    if (value === "limit") throw new ApiError("resource-exhausted", "Address search is resting for today.", {}, "PLACES_LIMIT");
    return value;
  };
  const officeMap = (): Record<string, CompanyOffice> => {
    try { return JSON.parse(store.getItem(OFFICE_KEY) ?? "{}") as Record<string, CompanyOffice>; } catch { return {}; }
  };
  const readOffice = (companyId: string): CompanyOffice | null => officeMap()[companyId] ?? null;
  /** Latency only in the browser preview; tests run without it. */
  const aiDelay = (ms: number) => (typeof window === "undefined" ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms)));

  function staff(capability: Capability): Session {
    const session = deps.session();
    if (!session) throw new ApiError("unauthenticated", "Sign in to continue.", {}, "UNAUTHENTICATED");
    if (!can(session.role, capability)) throw new ApiError("permission-denied", "Your role can’t do this.", {}, "INSUFFICIENT_ROLE");
    return session;
  }
  const log = (state: OpsState, session: Session, entry: Omit<AuditEntry, "id" | "at" | "actorId" | "actorName" | "actorRole" | "changes"> & { changes?: AuditEntry["changes"] }) => {
    state.audit.push({ changes: [], ...entry, companyId: session.companyId, id: `aud-${state.audit.length + 1}-${now().getTime()}`, at: now().toISOString(), actorId: session.uid, actorName: session.name, actorRole: session.role });
  };
  const strip = <T extends { companyId: string }>(item: T): Omit<T, "companyId"> => {
    const { companyId: _ignored, ...rest } = item;
    void _ignored;
    return rest;
  };
  /** Organizers read people without balances; admins see points. */
  const view = (session: Session, m: StoredMember): Member => ({ ...strip(m), pointsBalance: session.role === "admin" ? m.pointsBalance : null });
  const company = (state: OpsState, session: Session) => state.companies[session.companyId];
  const teamNames = (state: OpsState, session: Session, ids: string[]) =>
    ids.map((id) => company(state, session).teams.find((t) => t.id === id)?.name ?? id).join("; ");
  const reasonRequired = (reason: string, field = "reason") => {
    if (reason.trim().length < 3) throw new ApiError("invalid-argument", "Give a reason (at least 3 characters).", { [field]: "Give a reason." }, "VALIDATION_FAILED");
  };

  function member(state: OpsState, session: Session, id: string): StoredMember {
    const found = state.members.find((m) => m.id === id && m.companyId === session.companyId);
    if (!found) throw new ApiError("not-found", "That member doesn’t exist.", {}, "MEMBER_NOT_FOUND");
    return found;
  }
  const admins = (state: OpsState, session: Session) => state.members.filter((m) => m.companyId === session.companyId && m.role === "admin" && m.status === "active");

  /** Shared checks of approve and reject: not your own entry, exists, and unchanged since it was listed. */
  function reviewTarget(state: OpsState, session: Session, listed: Submission) {
    const found = state.submissions?.find((x) => x.companyId === session.companyId && x.id === listed.id);
    if (!found) throw new ApiError("not-found", "That submission doesn’t exist any more.", {}, "SUBMISSION_NOT_FOUND");
    if (found.userId === session.uid) throw new ApiError("permission-denied", "You can’t review your own submission.", {}, "SELF_REVIEW");
    if (found.changeOnReview) {
      // The member edits their entry right as you review (demo of SUBMISSION_CHANGED).
      found.changeOnReview = false;
      found.caption = `${found.caption} (edited just now)`.trim();
      found.updatedAt = now().toISOString();
      save(state);
    }
    if (listed.updatedAt !== found.updatedAt) throw new ApiError("failed-precondition", "The member changed this submission after you opened it.", {}, "SUBMISSION_CHANGED");
    return found;
  }

  // ----- import planning (mirrors importEmployeesV1 / applyEmployeeImportV1)
  function currentValues(state: OpsState, session: Session, email: string): { values: Record<string, string>; target: "member" | "roster" } | null {
    const m = state.members.find((x) => x.companyId === session.companyId && x.email === email);
    const r = state.roster.find((x) => x.companyId === session.companyId && x.email === email && x.state === "invited");
    const source = m ?? r;
    if (!source) return null;
    return {
      target: m ? "member" : "roster",
      values: {
        displayName: source.displayName, role: source.role, teams: teamNames(state, session, source.teamIds), department: source.department,
        jobTitle: source.jobTitle, workLocation: source.workLocation, managerEmail: r?.managerEmail ?? "", startDate: r?.startDate ?? "",
      },
    };
  }
  function planRow(state: OpsState, session: Session, row: ImportRow, rowNumber: number): PlanInternal {
    const info = company(state, session);
    const errors = validateRow(row, info.emailDomain).map((message) => ({ code: "VALIDATION_FAILED", message }));
    const teamIds: string[] = [];
    for (const name of row.teams) {
      const team = info.teams.find((t) => t.id === name || t.name.toLowerCase() === name.toLowerCase());
      if (team) teamIds.push(team.id); else errors.push({ code: "TEAM_NOT_FOUND", message: `Unknown team “${name}”.` });
    }
    const current = currentValues(state, session, row.email);
    if (!current && !row.displayName) errors.push({ code: "VALIDATION_FAILED", message: "New people need a name." });
    const existingMember = state.members.find((m) => m.companyId === session.companyId && m.email === row.email);
    if (existingMember?.role === "admin" && row.role && row.role !== "admin") errors.push({ code: "ADMIN_ROLE_PROTECTED", message: "An admin’s role can’t be changed by import." });
    if (errors.length) return { rowNumber, email: row.email, action: "invalid", target: "none", changes: [], errors };
    const wanted: Record<string, string> = {
      displayName: row.displayName, role: row.role || (current ? "" : "member"), teams: teamIds.map((id) => info.teams.find((t) => t.id === id)!.name).join("; "),
      department: row.department, jobTitle: row.jobTitle, workLocation: row.workLocation, managerEmail: row.managerEmail, startDate: row.startDate,
    };
    if (!current) {
      return { rowNumber, email: row.email, action: "create", target: "roster", errors: [], changes: IMPORT_FIELDS.filter((f) => f !== "email" && wanted[f]).map((field) => ({ field, before: "", after: wanted[field] })) };
    }
    // Blank cells keep the current value; existing members keep their Google display name.
    const changes: FieldChange[] = IMPORT_FIELDS.filter((f) => f !== "email" && !(f === "displayName" && current.target === "member") && wanted[f] && wanted[f] !== current.values[f])
      .map((field) => ({ field, before: current.values[field], after: wanted[field] }));
    return { rowNumber, email: row.email, action: changes.length ? "update" : "unchanged", target: current.target, changes, errors: [] };
  }
  function applyPlanned(state: OpsState, session: Session, row: ImportRow, plan: PlanInternal): ApplyRowResult {
    const base = { rowNumber: plan.rowNumber, email: row.email };
    if (plan.action === "invalid") return { ...base, outcome: "failed", message: plan.errors.map((e) => e.message).join(" ") };
    if (plan.action === "unchanged") return { ...base, outcome: "unchanged" };
    const info = company(state, session);
    const ids = row.teams.map((name) => info.teams.find((t) => t.id === name || t.name.toLowerCase() === name.toLowerCase())?.id).filter((x): x is string => !!x);
    const existingMember = state.members.find((m) => m.companyId === session.companyId && m.email === row.email);
    const entry = state.roster.find((r) => r.companyId === session.companyId && r.email === row.email && r.state === "invited");
    const patch = {
      ...(row.role ? { role: row.role } : {}), ...(ids.length ? { teamIds: ids } : {}), ...(row.department ? { department: row.department } : {}),
      ...(row.jobTitle ? { jobTitle: row.jobTitle } : {}), ...(row.workLocation ? { workLocation: row.workLocation } : {}),
    };
    if (existingMember) {
      Object.assign(existingMember, patch, { revision: existingMember.revision + 1 });
    } else if (entry) {
      Object.assign(entry, patch, row.displayName ? { displayName: row.displayName } : {}, { managerEmail: row.managerEmail || entry.managerEmail, startDate: row.startDate || entry.startDate });
    } else {
      state.roster = state.roster.filter((r) => !(r.companyId === session.companyId && r.email === row.email));
      state.roster.push({
        companyId: session.companyId, entryId: row.email, email: row.email, displayName: row.displayName, role: row.role || "member", teamIds: ids,
        workLocation: row.workLocation, department: row.department, jobTitle: row.jobTitle, managerEmail: row.managerEmail, startDate: row.startDate,
        state: "invited", invitedAt: now().toISOString(),
      });
    }
    log(state, session, { action: "import.apply", targetType: "roster", targetId: row.email, summary: `${plan.action === "create" ? "Added" : "Updated"} ${row.email} from an import`, changes: plan.changes.map((c) => ({ field: c.field, before: c.before, after: c.after })) });
    return { ...base, outcome: plan.action === "create" ? "created" : "updated" };
  }

  const attendeeKey = (session: Session, eventId: string) => `${session.companyId}:${eventId}`;
  function attendeesOf(state: OpsState, session: Session, eventId: string): Attendee[] {
    const key = attendeeKey(session, eventId);
    if (!state.attendees[key]) {
      const event = deps.findEvent(session.companyId, eventId);
      if (!event) throw new ApiError("not-found", "That event doesn’t exist.", {}, "EVENT_NOT_FOUND");
      const pool = state.members.filter((m) => m.companyId === session.companyId && m.status === "active");
      const past = Date.parse(event.endTime) < now().getTime();
      const offset = eventId.length % pool.length;
      state.attendees[key] = Array.from({ length: Math.min(event.attendeeCount, pool.length) }, (_, i) => {
        const m = pool[(i + offset) % pool.length];
        return {
          memberId: m.id, name: m.displayName, email: m.email, ...profileOf(m), department: m.department, jobTitle: m.jobTitle,
          rsvpAt: isoAgo(now(), 20 - (i % 10)), checkedIn: past && i % 5 !== 4, addedByAdmin: false,
        };
      });
    }
    return state.attendees[key];
  }

  return {
    async companyInfo() {
      const state = load();
      const session = staff("attendees.manage");
      return company(state, session);
    },

    // ----- albums
    async listPhotos(eventId) {
      const state = load();
      const session = staff("albums.moderate");
      if (!deps.findEvent(session.companyId, eventId)) throw new ApiError("not-found", "That event doesn’t exist.", {}, "EVENT_NOT_FOUND");
      return state.photos.filter((p) => p.companyId === session.companyId && p.eventId === eventId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map((p) => strip(p));
    },
    async listPhotoComments(eventId, photoId) {
      const state = load();
      const session = staff("albums.moderate");
      return state.comments.filter((c) => c.companyId === session.companyId && c.eventId === eventId && c.photoId === photoId)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).map(({ companyId: _c, eventId: _e, ...rest }) => (void _c, void _e, rest));
    },
    async photoImage(photo) {
      return photo.previewImage ?? asset("/img/events/games.jpg");
    },
    async removePhoto(eventId, photoId, reason) {
      const state = load();
      const session = staff("albums.moderate");
      reasonRequired(reason);
      const photo = state.photos.find((p) => p.id === photoId && p.eventId === eventId && p.companyId === session.companyId);
      // Removing a photo that is already gone converges (removed: false), like the callable.
      if (!photo) return;
      state.photos = state.photos.filter((p) => p !== photo);
      state.comments = state.comments.filter((c) => !(c.companyId === session.companyId && c.photoId === photoId));
      log(state, session, { action: "photo.remove", targetType: "photo", targetId: `${eventId}/${photoId}`, summary: `Removed a photo by ${photo.uploaderName} and ${photo.commentCount} comments`, reason });
      save(state);
    },
    async removePhotoComment(eventId, photoId, commentId, reason) {
      const state = load();
      const session = staff("albums.moderate");
      reasonRequired(reason);
      const comment = state.comments.find((c) => c.id === commentId && c.photoId === photoId && c.eventId === eventId && c.companyId === session.companyId);
      if (!comment) return;
      state.comments = state.comments.filter((c) => c !== comment);
      const photo = state.photos.find((p) => p.id === photoId && p.companyId === session.companyId);
      if (photo) photo.commentCount = Math.max(0, photo.commentCount - 1);
      log(state, session, { action: "photo.comment.remove", targetType: "comment", targetId: `${eventId}/${photoId}/${commentId}`, summary: `Removed a comment by ${comment.authorName}`, reason });
      save(state);
    },

    // ----- attendees
    async listAttendees(eventId) {
      const state = load();
      const session = staff("attendees.manage");
      const list = attendeesOf(state, session, eventId);
      save(state);
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    },
    async addAttendee(input) {
      const state = load();
      const session = staff("attendees.manage");
      const event = deps.findEvent(session.companyId, input.eventId);
      if (!event) throw new ApiError("not-found", "That event doesn’t exist.", {}, "EVENT_NOT_FOUND");
      const receiptKey = `${session.companyId}:${session.uid}:${input.requestId}`;
      if (state.receipts[receiptKey]) return { attendeeCount: event.attendeeCount, capacity: event.capacity };
      const m = state.members.find((x) => x.id === input.memberId && x.companyId === session.companyId && x.status === "active");
      if (!m) throw new ApiError("not-found", "That member doesn’t exist or isn’t active.", {}, "MEMBER_NOT_FOUND");
      if (event.status === "cancelled" || Date.parse(event.endTime) <= now().getTime()) throw new ApiError("failed-precondition", "This event is closed.", {}, "EVENT_CLOSED");
      const list = attendeesOf(state, session, input.eventId);
      if (list.some((a) => a.memberId === m.id)) return { attendeeCount: event.attendeeCount, capacity: event.capacity };
      const full = event.attendeeCount >= event.capacity;
      if (full && !input.capacityOverrideReason) throw new ApiError("resource-exhausted", "This event is full. Add the person anyway with a reason.", {}, "EVENT_FULL");
      if (full) reasonRequired(input.capacityOverrideReason ?? "", "capacityOverrideReason");
      list.push({ memberId: m.id, name: m.displayName, email: m.email, ...profileOf(m), department: m.department, jobTitle: m.jobTitle, rsvpAt: now().toISOString(), checkedIn: false, addedByAdmin: true });
      const result = deps.bumpAttendees(session.companyId, input.eventId, 1, full ? event.attendeeCount + 1 : undefined);
      state.receipts[receiptKey] = m.id;
      log(state, session, {
        action: "attendee.add", targetType: "attendee", targetId: `${input.eventId}/${m.id}`, summary: `Added ${m.displayName} to ${event.title}${full ? " over capacity" : ""}${input.notify ? ", notified" : ""}`,
        reason: input.capacityOverrideReason, changes: full ? [{ field: "capacity", before: String(event.capacity), after: String(result.capacity) }] : [],
      });
      save(state);
      return result;
    },
    async removeAttendee(eventId, memberId, notify, reason) {
      const state = load();
      const session = staff("attendees.manage");
      const event = deps.findEvent(session.companyId, eventId);
      if (!event) throw new ApiError("not-found", "That event doesn’t exist.", {}, "EVENT_NOT_FOUND");
      const list = attendeesOf(state, session, eventId);
      const found = list.find((a) => a.memberId === memberId);
      if (!found) return { attendeeCount: event.attendeeCount };
      state.attendees[attendeeKey(session, eventId)] = list.filter((a) => a !== found);
      const result = deps.bumpAttendees(session.companyId, eventId, -1);
      log(state, session, { action: "attendee.remove", targetType: "attendee", targetId: `${eventId}/${memberId}`, summary: `Cancelled ${found.name}’s RSVP for ${event.title}${notify ? ", notified" : ""}`, reason: reason || undefined });
      save(state);
      return { attendeeCount: result.attendeeCount };
    },
    async recordAttendance(eventId, memberId, checkedIn) {
      const state = load();
      const session = staff("attendees.manage");
      const event = deps.findEvent(session.companyId, eventId);
      if (!event) throw new ApiError("not-found", "That event doesn’t exist.", {}, "EVENT_NOT_FOUND");
      if (Date.parse(event.startTime) > now().getTime()) throw new ApiError("failed-precondition", "Attendance opens when the event starts.", {}, "EVENT_NOT_STARTED");
      const found = attendeesOf(state, session, eventId).find((a) => a.memberId === memberId);
      if (!found) throw new ApiError("failed-precondition", "That person isn’t going.", {}, "NOT_GOING");
      if (found.checkedIn === checkedIn) return { pointsAwarded: 0, checkedIn };
      const key = `attendance_${eventId}_${memberId}`;
      if (!checkedIn && state.receipts[key]) throw new ApiError("failed-precondition", "Points were already awarded, so this can’t be undone.", {}, "ATTENDANCE_LOCKED");
      found.checkedIn = checkedIn;
      let awarded = 0;
      if (checkedIn && event.pointsValue > 0 && !state.receipts[key]) {
        awarded = event.pointsValue;
        state.receipts[key] = "awarded";
        const m = state.members.find((x) => x.id === memberId && x.companyId === session.companyId);
        if (m) m.pointsBalance += awarded;
      }
      log(state, session, { action: "attendance.record", targetType: "attendee", targetId: `${eventId}/${memberId}`, summary: `Marked ${found.name} ${checkedIn ? "checked in" : "as a no-show"} at ${event.title}`, changes: [{ field: "checkedIn", before: String(!checkedIn), after: String(checkedIn) }] });
      save(state);
      return { pointsAwarded: awarded, checkedIn };
    },

    // ----- members
    async listMembers() {
      const state = load();
      const session = staff("members.view");
      return state.members.filter((m) => m.companyId === session.companyId).map((m) => view(session, m)).sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
    async listMembersPage(q: MemberQuery, cursor, pageSize = 25) {
      const state = load();
      const session = staff("members.view");
      const text = q.query.trim().toLowerCase();
      const all = state.members.filter((m) => m.companyId === session.companyId).sort((a, b) => (a.id < b.id ? -1 : 1));
      const matches = (m: StoredMember) =>
        (q.status === "all" || m.status === q.status) && (q.role === "all" || m.role === q.role) && (q.teamId === "all" || !q.teamId || m.teamIds.includes(q.teamId)) &&
        (q.workLocation === "all" || !q.workLocation || m.workLocation.toLowerCase() === q.workLocation.toLowerCase()) &&
        (!text || `${m.displayName} ${m.email} ${m.department} ${m.jobTitle} ${m.workLocation}`.toLowerCase().includes(text));
      const rest = all.filter((m) => !cursor || m.id > cursor);
      const page = rest.filter(matches).slice(0, pageSize);
      const last = page[page.length - 1];
      const more = last ? rest.some((m) => m.id > last.id && matches(m)) : false;
      return { members: page.map((m) => view(session, m)), nextCursor: more ? last!.id : null, total: cursor ? null : all.length };
    },
    async getMember(id) {
      const state = load();
      const session = staff("members.view");
      return view(session, member(state, session, id));
    },
    async updateMember(id, expectedRevision, patch) {
      const state = load();
      const session = staff("members.edit");
      const m = member(state, session, id);
      if (m.revision !== expectedRevision) throw new ApiError("aborted", "Someone else changed this member. Reload to see their changes.", {}, "REVISION_CONFLICT");
      if (patch.role && patch.role !== "admin" && m.role === "admin" && admins(state, session).length <= 1) {
        throw new ApiError("failed-precondition", "This is the last admin. Make someone else an admin first.", { role: "Last admin." }, "LAST_ADMIN");
      }
      const changes: AuditEntry["changes"] = [];
      for (const key of ["role", "workLocation", "department", "jobTitle"] as const) {
        const value = patch[key];
        if (value !== undefined && value !== m[key]) { changes.push({ field: key, before: m[key], after: value }); (m as unknown as Record<string, string>)[key] = value; }
      }
      if (patch.teamIds && patch.teamIds.join() !== m.teamIds.join()) {
        changes.push({ field: "teams", before: teamNames(state, session, m.teamIds), after: teamNames(state, session, patch.teamIds) });
        m.teamIds = patch.teamIds;
      }
      if (changes.length === 0) return view(session, m);
      m.revision += 1;
      log(state, session, { action: "member.update", targetType: "member", targetId: m.id, summary: `Edited ${m.displayName}: ${changes.map((c) => c.field).join(", ")}`, changes });
      save(state);
      return view(session, m);
    },
    async setMemberStatus(id, status, reason) {
      const state = load();
      const session = staff("members.edit");
      reasonRequired(reason);
      const m = member(state, session, id);
      if (status === "deactivated") {
        if (m.id === session.uid) throw new ApiError("failed-precondition", "You can’t deactivate yourself.", {}, "CANNOT_DEACTIVATE_SELF");
        if (m.role === "admin" && admins(state, session).length <= 1) throw new ApiError("failed-precondition", "This is the last admin.", {}, "LAST_ADMIN");
      }
      if (m.status === status) return view(session, m);
      const before = m.status;
      m.status = status;
      m.revision += 1;
      log(state, session, { action: "member.status", targetType: "member", targetId: m.id, summary: status === "deactivated" ? `Deactivated ${m.displayName}: sign-in blocked, upcoming RSVPs cancelled` : `Reactivated ${m.displayName}`, reason, changes: [{ field: "status", before, after: status }] });
      save(state);
      return view(session, m);
    },
    async resetMemberProfile(id, reason) {
      const state = load();
      const session = staff("members.edit");
      reasonRequired(reason);
      const m = member(state, session, id);
      const changes = [{ field: "avatar", before: m.avatarId, after: "" }, { field: "city", before: m.city, after: "" }];
      Object.assign(m, { avatarId: "", photoURL: "", city: "", revision: m.revision + 1 });
      log(state, session, { action: "member.reset", targetType: "member", targetId: m.id, summary: `Reset ${m.displayName}’s profile; identity, role and points kept`, reason, changes });
      save(state);
      return view(session, m);
    },
    async adjustPoints(id, requestId, delta, reason) {
      const state = load();
      const session = staff("points.adjust");
      reasonRequired(reason);
      const m = member(state, session, id);
      const receiptKey = `${session.companyId}:${session.uid}:${requestId}`;
      if (state.receipts[receiptKey]) return view(session, m);
      if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) throw new ApiError("invalid-argument", "Enter a whole number other than 0.", { delta: "Enter a whole number other than 0." }, "VALIDATION_FAILED");
      if (m.pointsBalance + delta < 0) throw new ApiError("failed-precondition", "Points can’t go below zero.", { delta: "Points can’t go below zero." }, "INSUFFICIENT_POINTS");
      const before = m.pointsBalance;
      m.pointsBalance += delta;
      state.receipts[receiptKey] = m.id;
      log(state, session, { action: "points.adjust", targetType: "points", targetId: m.id, summary: `Changed ${m.displayName}’s points by ${delta > 0 ? "+" : ""}${delta}`, reason, changes: [{ field: "points", before: String(before), after: String(m.pointsBalance) }] });
      save(state);
      return view(session, m);
    },

    // ----- roster
    async listRosterPage(q: RosterQuery, cursor, pageSize = 25) {
      const state = load();
      const session = staff("roster.manage");
      const stateOf = (r: StoredRoster): RosterRow["state"] => {
        const m = r.memberId ? state.members.find((x) => x.id === r.memberId) : undefined;
        return m ? (m.status === "deactivated" ? "deactivated" : "active") : r.state;
      };
      const entries = state.roster.filter((r) => r.companyId === session.companyId).sort((a, b) => (a.entryId < b.entryId ? -1 : 1));
      const text = q.query.trim().toLowerCase();
      const matches = (r: StoredRoster) => (q.state === "all" || stateOf(r) === q.state) && (!text || `${r.displayName} ${r.email} ${r.department} ${r.jobTitle} ${r.workLocation}`.toLowerCase().includes(text));
      const rest = entries.filter((r) => !cursor || r.entryId > cursor);
      const page = rest.filter(matches).slice(0, pageSize);
      const last = page[page.length - 1];
      const more = last ? rest.some((r) => r.entryId > last.entryId && matches(r)) : false;
      let counts: RosterCounts | null = null;
      if (!cursor) {
        counts = { all: entries.length, invited: 0, active: 0, deactivated: 0, revoked: 0 };
        for (const r of entries) counts[stateOf(r)] += 1;
      }
      return { rows: page.map((r) => ({ ...strip(r), state: stateOf(r) })), nextCursor: more ? last!.entryId : null, counts, inviteEmail: state.inviteEmail !== false };
    },
    async resendInvite(row) {
      const state = load();
      const session = staff("roster.manage");
      const entry = state.roster.find((r) => r.companyId === session.companyId && r.entryId === row.entryId);
      if (!entry) throw new ApiError("not-found", "That person isn’t on the roster.", {}, "ROSTER_ENTRY_NOT_FOUND");
      if (entry.state === "active" || entry.state === "deactivated") throw new ApiError("failed-precondition", "This person already signed in.", {}, "ROSTER_ENTRY_CLAIMED");
      if (entry.state !== "invited") throw new ApiError("failed-precondition", "Invite this person again before resending.", {}, "ROSTER_ENTRY_NOT_INVITED");
      const sent = entry.resendCount ?? 0;
      if (sent >= MAX_RESENDS) throw new ApiError("resource-exhausted", "This invite was already resent several times. Reach out to the person directly.", {}, "RESEND_LIMIT");
      entry.resendCount = sent + 1;
      entry.lastResentAt = now().toISOString();
      log(state, session, { action: "roster.resend", targetType: "roster", targetId: entry.entryId, summary: `Resent the invite for ${entry.email} (#${sent + 1})`, changes: [{ field: "resendCount", before: String(sent), after: String(sent + 1) }] });
      save(state);
      return { resendCount: sent + 1, lastResentAt: entry.lastResentAt, ...inviteMessage({ name: entry.displayName, company: company(state, session).name, email: entry.email, role: entry.role }) };
    },
    // Mirrors sendRosterInviteEmailV1: invited entries only, at most MAX_INVITE_EMAILS, an hour apart; nothing is sent in mock mode.
    async sendInviteEmail(row) {
      const state = load();
      const session = staff("roster.manage");
      const entry = state.roster.find((r) => r.companyId === session.companyId && r.entryId === row.entryId);
      if (!entry) throw new ApiError("not-found", "That person isn’t on the roster.", {}, "ROSTER_ENTRY_NOT_FOUND");
      if (entry.state === "active" || entry.state === "deactivated") throw new ApiError("failed-precondition", "This person already signed in.", {}, "ROSTER_ENTRY_CLAIMED");
      if (entry.state !== "invited") throw new ApiError("failed-precondition", "Invite this person again before resending.", {}, "ROSTER_ENTRY_NOT_INVITED");
      if (state.inviteEmail === false) throw new ApiError("failed-precondition", "Email isn't turned on for your company yet. Copy the invite message instead.", {}, "EMAIL_NOT_ENABLED", undefined, "errors.emailNotEnabled");
      const sent = entry.inviteEmailCount ?? 0;
      if (sent >= MAX_INVITE_EMAILS) throw new ApiError("resource-exhausted", "This person already got several invitation emails. Reach out to them directly.", {}, "INVITE_EMAIL_LIMIT", undefined, "errors.inviteEmailLimit");
      if (entry.lastInviteEmailAt && now().getTime() - new Date(entry.lastInviteEmailAt).getTime() < 3_600_000) {
        throw new ApiError("resource-exhausted", "An invitation email went out less than an hour ago. Try again later.", {}, "INVITE_EMAIL_TOO_SOON", undefined, "errors.inviteEmailTooSoon");
      }
      entry.inviteEmailCount = sent + 1;
      entry.lastInviteEmailAt = now().toISOString();
      log(state, session, { action: "roster.inviteEmail", targetType: "roster", targetId: entry.entryId, summary: `Emailed an invite to ${entry.email} (#${sent + 1})`, changes: [{ field: "inviteEmailCount", before: String(sent), after: String(sent + 1) }] });
      save(state);
      return { inviteEmailCount: sent + 1, lastInviteEmailAt: entry.lastInviteEmailAt };
    },
    async backfillRoster(dryRun, _requestId, cursor): Promise<BackfillStep> {
      const state = load();
      const session = staff("roster.manage");
      const members = state.members.filter((m) => m.companyId === session.companyId).sort((a, b) => (a.id < b.id ? -1 : 1)).filter((m) => !cursor || m.id > cursor).slice(0, 100);
      const step: BackfillStep = { dryRun, scanned: members.length, created: 0, existing: 0, skipped: 0, nextCursor: null, done: members.length < 100 };
      for (const m of members) {
        if (!m.email) { step.skipped += 1; continue; }
        if (state.roster.some((r) => r.companyId === session.companyId && r.email === m.email)) { step.existing += 1; continue; }
        step.created += 1;
        if (!dryRun) {
          state.roster.push({
            companyId: session.companyId, entryId: m.email, email: m.email, displayName: m.displayName, role: m.role, teamIds: m.teamIds, workLocation: m.workLocation,
            department: m.department, jobTitle: m.jobTitle, managerEmail: "", startDate: "", state: "active", memberId: m.id, invitedAt: m.createdAt, ...profileOf(m),
          });
        }
      }
      if (!step.done) step.nextCursor = members[members.length - 1]!.id;
      if (!dryRun) {
        log(state, session, { action: "roster.backfill", targetType: "roster", targetId: cursor ?? "start", summary: `Added existing members to the roster: ${step.created} added, ${step.existing} already listed, ${step.skipped} skipped`, changes: [{ field: "created", before: "", after: String(step.created) }] });
        save(state);
      }
      return step;
    },
    async getImport(jobId): Promise<ImportJobInfo> {
      const state = load();
      const session = staff("import.run");
      const job = state.jobs[jobId];
      if (!job || job.companyId !== session.companyId) throw new ApiError("not-found", "That import doesn’t exist any more.", {}, "IMPORT_JOB_NOT_FOUND");
      const count = (o: string) => job.results.filter((r) => r.outcome === o).length;
      return {
        jobId, status: job.status, chunkCount: job.chunkCount, nextChunk: job.nextChunk, planHash: job.planHash, fileName: "",
        progress: { processed: job.results.length, total: job.rows.length, created: count("created"), updated: count("updated"), unchanged: count("unchanged"), failed: count("failed") },
      };
    },
    async revokeRosterEntry(entryId) {
      const state = load();
      const session = staff("roster.manage");
      const entry = state.roster.find((r) => r.companyId === session.companyId && r.entryId === entryId);
      if (!entry) throw new ApiError("not-found", "That person isn’t on the roster.", {}, "ROSTER_ENTRY_NOT_FOUND");
      if (entry.state !== "invited") return; // revoked already, or a claimed entry (revoke the member instead)
      entry.state = "revoked";
      log(state, session, { action: "roster.revoke", targetType: "roster", targetId: entryId, summary: `Withdrew the invite for ${entry.displayName}`, changes: [{ field: "status", before: "invited", after: "revoked" }] });
      save(state);
    },
    async reinvite(row) {
      const state = load();
      const session = staff("roster.manage");
      const entry = state.roster.find((r) => r.companyId === session.companyId && r.entryId === row.entryId);
      if (!entry) throw new ApiError("not-found", "That person isn’t on the roster.", {}, "ROSTER_ENTRY_NOT_FOUND");
      if (state.members.some((m) => m.companyId === session.companyId && m.email === entry.email)) throw new ApiError("failed-precondition", "That person already has an account.", {}, "EMAIL_ALREADY_MEMBER");
      if (entry.state === "invited") return;
      entry.state = "invited";
      entry.invitedAt = now().toISOString();
      log(state, session, { action: "roster.upsert", targetType: "roster", targetId: entry.entryId, summary: `Invited ${entry.displayName} again`, changes: [{ field: "status", before: "revoked", after: "invited" }] });
      save(state);
    },

    // ----- import
    async planImport(request) {
      const state = load();
      const session = staff("import.run");
      if (request.rows.length === 0 || request.rows.length > IMPORT_LIMITS.maxRows) {
        throw new ApiError("invalid-argument", `Send 1 to ${IMPORT_LIMITS.maxRows} rows.`, {}, request.rows.length ? "IMPORT_TOO_LARGE" : "VALIDATION_FAILED");
      }
      const planHash = hashOf(request.rows);
      const jobId = `job-${request.requestId.replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}`;
      const existing = state.jobs[jobId];
      if (existing && existing.companyId !== session.companyId) throw new ApiError("permission-denied", "That import belongs to another company.", {}, "COMPANY_MISMATCH");
      if (existing && existing.planHash !== planHash) throw new ApiError("failed-precondition", "This request ID was already used with different rows.", {}, "REQUEST_REUSED");
      const seen = new Set<string>();
      const plans = request.rows.map((row, i) => {
        const plan = planRow(state, session, row, i + 1);
        if (row.email && seen.has(row.email)) return { ...plan, action: "invalid" as const, target: "none" as const, changes: [], errors: [...plan.errors, { code: "DUPLICATE_EMAIL", message: "Duplicate email in this file." }] };
        seen.add(row.email);
        return plan;
      });
      const chunkCount = Math.ceil(plans.length / IMPORT_LIMITS.serverChunk);
      state.jobs[jobId] = existing ?? { companyId: session.companyId, planHash, rows: request.rows, plans, nextChunk: 0, chunkCount, results: [], status: "planned" };
      save(state);
      return { jobId, planHash, chunkCount, rows: plans.map((p) => ({ ...p })) } satisfies ImportPlanResponse;
    },
    async applyImportStep(jobId, planHash) {
      const state = load();
      const session = staff("import.run");
      const job = state.jobs[jobId];
      if (!job || job.companyId !== session.companyId) throw new ApiError("not-found", "Run the preview again before applying.", {}, "IMPORT_JOB_NOT_FOUND");
      if (job.planHash !== planHash) throw new ApiError("failed-precondition", "The preview is out of date. Run it again.", {}, "IMPORT_PLAN_MISMATCH");
      const progress = () => {
        const count = (o: string) => job.results.filter((r) => r.outcome === o).length;
        return { processed: job.results.length, total: job.rows.length, created: count("created"), updated: count("updated"), unchanged: count("unchanged"), failed: count("failed") };
      };
      if (job.nextChunk >= job.chunkCount) return { status: job.status === "planned" ? "completed" : job.status, done: true, progress: progress(), results: [] };
      const start = job.nextChunk * IMPORT_LIMITS.serverChunk;
      // Each row is planned again against current data, so a row changed since the preview is never applied blindly.
      const results = job.rows.slice(start, start + IMPORT_LIMITS.serverChunk).map((row, i) => applyPlanned(state, session, row, planRow(state, session, row, start + i + 1)));
      job.results.push(...results);
      job.nextChunk += 1;
      const done = job.nextChunk >= job.chunkCount;
      job.status = done ? (job.results.some((r) => r.outcome === "failed") ? "completed_with_errors" : "completed") : "running";
      if (done) log(state, session, { action: "import.apply", targetType: "import", targetId: jobId, summary: `Import finished: ${progress().created} added, ${progress().updated} updated, ${progress().failed} failed` });
      save(state);
      return { status: job.status, done, progress: progress(), results };
    },

    // ----- challenge submissions
    async listSubmissions(challengeId, status, cursor) {
      const state = load();
      const session = staff("challenges.review");
      const theme = deps.themes(session.companyId).find((t) => t.id === challengeId);
      if (!theme) throw new ApiError("not-found", "That weekly theme doesn’t exist.", {}, "CHALLENGE_NOT_FOUND");
      state.submissions ??= [];
      state.seededThemes ??= [];
      if (!state.seededThemes.includes(`${session.companyId}:${challengeId}`)) {
        state.seededThemes.push(`${session.companyId}:${challengeId}`);
        seedSubmissions(state, session.companyId, theme, now());
        save(state);
      }
      const all = state.submissions.filter((x) => x.companyId === session.companyId && x.challengeId === challengeId && x.status === status).sort((a, b) => a.id.localeCompare(b.id));
      const page = all.filter((x) => !cursor || x.id > cursor).slice(0, SUBMISSION_PAGE);
      const last = page[page.length - 1];
      const more = last && all.some((x) => x.id > last.id);
      return { submissions: page.map(({ companyId: _c, changeOnReview: _x, ...rest }) => (void _c, void _x, rest)), nextCursor: more ? last.id : null };
    },
    async submissionEvidence(submission) {
      const pictures = ["fitness", "outdoors", "hiking", "games", "cooking"];
      return asset(`/img/events/${pictures[submission.userId.length % pictures.length]}.jpg`);
    },
    async approveSubmission(submission) {
      const state = load();
      const session = staff("challenges.review");
      const found = reviewTarget(state, session, submission);
      const theme = deps.themes(session.companyId).find((t) => t.id === submission.challengeId)!;
      if (found.status === "approved") return { pointsAwarded: 0, replayed: true };
      if (found.status === "rejected") throw new ApiError("failed-precondition", "This was sent back for changes. The member has to resubmit before it can be approved.", {}, "SUBMISSION_NOT_PENDING");
      const owner = state.members.find((m) => m.id === found.userId && m.companyId === session.companyId && m.status === "active");
      if (!owner) throw new ApiError("not-found", "The person who submitted this is no longer in the company.", {}, "SUBMITTER_NOT_FOUND");
      owner.pointsBalance += theme.pointsReward;
      Object.assign(found, { status: "approved", reviewedAt: now().toISOString(), pointsAwarded: theme.pointsReward, reviewNote: null });
      save(state);
      return { pointsAwarded: theme.pointsReward, replayed: false };
    },
    async rejectSubmission(submission, reason) {
      const state = load();
      const session = staff("challenges.review");
      const note = reason.trim();
      if (note.length < 1 || note.length > 280) throw new ApiError("invalid-argument", "Write a note for the member (1 to 280 characters).", { reason: "Write a note." }, "VALIDATION_FAILED");
      const found = reviewTarget(state, session, submission);
      if (found.status === "approved") throw new ApiError("failed-precondition", "This was already approved and can’t be sent back.", {}, "SUBMISSION_LOCKED");
      if (found.status === "rejected") return { replayed: true };
      Object.assign(found, { status: "rejected", reviewedAt: now().toISOString(), reviewNote: note });
      save(state);
      return { replayed: false };
    },

    // ----- bug reports
    async listBugReports(q, cursor, pageSize = BUG_PAGE) {
      const state = load();
      const session = staff("bugreports.manage");
      if (!state.bugReports) { seedBugReports(state, now()); save(state); }
      const reports = state.bugReports ?? [];
      const text = q.query.trim().toLowerCase();
      const from = q.from ? Date.parse(`${q.from}T00:00:00.000Z`) : -Infinity;
      const to = q.to ? Date.parse(`${q.to}T23:59:59.999Z`) : Infinity;
      const own = reports.filter((b) => b.companyId === session.companyId && Date.parse(b.createdAt) >= from && Date.parse(b.createdAt) <= to
        && (q.category === "all" || b.category === q.category)
        && (!text || `${b.description} ${b.reporterName} ${b.screen} ${b.appVersion ?? ""} ${b.id} ${b.assigneeName ?? ""}`.toLowerCase().includes(text)))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1));
      const matching = own.filter((b) => q.status === "all" || b.status === q.status);
      const start = cursor ? matching.findIndex((b) => b.id === cursor) + 1 : 0;
      const page = matching.slice(start, start + pageSize);
      const counts: BugReportCounts | null = cursor ? null : {
        all: own.length, new: own.filter((b) => b.status === "new").length, triaged: own.filter((b) => b.status === "triaged").length,
        resolved: own.filter((b) => b.status === "resolved").length, capped: false,
      };
      const strippedPage = page.map(({ companyId: _c, reporterEmail: _e, diagnostics: _d, screenshot: _s, note: _n, revision: _r, updatedAt: _u, updatedByName: _b, ...rest }) => (void _c, void _e, void _d, void _s, void _n, void _r, void _u, void _b, rest));
      return { reports: strippedPage, nextCursor: start + pageSize < matching.length ? page[page.length - 1].id : null, counts };
    },
    async getBugReport(reportId) {
      const state = load();
      const session = staff("bugreports.manage");
      const found = state.bugReports?.find((b) => b.id === reportId && b.companyId === session.companyId);
      if (!found) throw new ApiError("not-found", "That report doesn’t exist.", {}, "BUG_REPORT_NOT_FOUND");
      const { companyId: _c, reporterEmail, diagnostics, screenshot, note, revision, updatedAt, updatedByName, ...report } = found;
      void _c;
      return { report, reporterEmail, diagnostics, screenshotUrl: screenshot, note, revision, updatedAt, updatedByName };
    },
    async updateBugReport(reportId, patch, expectedRevision) {
      const state = load();
      const session = staff("bugreports.manage");
      const found = state.bugReports?.find((b) => b.id === reportId && b.companyId === session.companyId);
      if (!found) throw new ApiError("not-found", "That report doesn’t exist.", {}, "BUG_REPORT_NOT_FOUND");
      if (expectedRevision !== found.revision) throw new ApiError("aborted", "Someone else updated this report. Reload it and try again.", {}, "REVISION_CONFLICT");
      if (patch.note !== undefined && patch.note.length > 2000) throw new ApiError("invalid-argument", "Notes can be up to 2,000 characters.", { note: "Too long." }, "VALIDATION_FAILED");
      let assignee: StoredMember | null | undefined;
      if (patch.assigneeId === null) assignee = null;
      else if (patch.assigneeId !== undefined) {
        assignee = state.members.find((m) => m.id === patch.assigneeId && m.companyId === session.companyId && m.role === "admin" && m.status === "active");
        if (!assignee) throw new ApiError("not-found", "That person can’t be assigned. Pick an admin of your company.", {}, "ASSIGNEE_NOT_FOUND");
      }
      const changes: AuditEntry["changes"] = [];
      if (patch.status !== undefined && patch.status !== found.status) { changes.push({ field: "status", before: found.status, after: patch.status }); found.status = patch.status; }
      if (patch.note !== undefined && patch.note.trim() !== found.note) { changes.push({ field: "note", before: found.note ? "(edited)" : "", after: patch.note.trim() ? "(edited)" : "" }); found.note = patch.note.trim(); found.hasNote = found.note !== ""; }
      if (assignee !== undefined && (assignee?.id ?? undefined) !== found.assigneeId) {
        changes.push({ field: "assignee", before: found.assigneeName ?? "", after: assignee?.displayName ?? "" });
        if (assignee) { found.assigneeId = assignee.id; found.assigneeName = assignee.displayName; } else { delete found.assigneeId; delete found.assigneeName; }
      }
      if (changes.length) {
        found.revision += 1;
        found.updatedAt = now().toISOString();
        found.updatedByName = session.name;
        log(state, session, { action: "bugreport.update", targetType: "bugReport", targetId: found.id, summary: `Updated bug report ${found.id.slice(0, 8)}`, changes });
        save(state);
      }
      return { status: found.status, note: found.note, assigneeId: found.assigneeId ?? null, assigneeName: found.assigneeName ?? null, revision: found.revision, updatedAt: found.updatedAt ?? now().toISOString(), changed: changes.length > 0 };
    },

    // ----- AI event ideas (admin only, like the server)
    async eventIdeaContext(): Promise<EventIdeaContext> {
      const session = staff("ai.generate");
      const { monthly, daily } = aiUsage(session.companyId);
      const ctx = mockIdeaContext(aiScenario(), monthly, daily, aiCreditsUsed(session.companyId), now());
      return { ...ctx, topInterests: ctx.topInterests.map((i) => ({ ...i, tagId: previewTagId(i.tagId) })), thinInterestTagIds: ctx.thinInterestTagIds.map(previewTagId) };
    },
    // A fake Jev provider: fixed, typed answers (no model call). `?jev=` picks a scenario, `?ai=nodata` has no suggestions.
    // Follows the server policy: a visit with a saved answer is free and makes no "model call"; only the first visit
    // (`?cache=first`) or a refresh computes and charges 1 credit, and never without credits. `?cache=` picks the saved state.
    async eventIdeaSuggestions(input) {
      staff("ai.generate");
      if (aiScenario() === "off") throw new ApiError("failed-precondition", `${t("off.title")}.`, {}, "AI_DISABLED");
      const search = typeof window === "undefined" ? "" : window.location.search;
      const scenario = suggestScenarioFromSearch(search);
      const cache = cacheScenarioFromSearch(search);
      const refresh = input?.refresh === true;
      const computing = refresh || (cache === "first" && savedSuggest.at === null);
      await aiDelay(scenario === "slow" ? 6000 : computing ? 1200 : 400);
      if (scenario === "error") throw new ApiError("failed-precondition", "Suggestions are not available right now.", {}, "AI_UNAVAILABLE");
      const session = staff("ai.generate");
      const used = aiCreditsUsed(session.companyId);
      const found = mockSuggestions(aiScenario() === "nodata" ? "none" : scenario);
      const considerations = rankConsiderationsByRules({ tagIds: ["tag-fitness", "tag-games"], goal: "team_bonding", groupSize: "team", budget: "under_15", timing: "after_work" })
        .map((r, i) => ({ id: r.id, probability: Math.round(Math.max(0.05, 0.86 - i * 0.04) * 1000) / 1000 }));
      const shape = (at: number, status: EventIdeaSuggestions["cacheStatus"], charged: number, credits: number, reason?: "data" | "age", answer = found): EventIdeaSuggestions => ({
        ...answer, considerations, cacheStatus: status, computedAt: new Date(at).toISOString(), creditsCharged: charged, credits: creditsOf(credits, now()),
        ...(reason ? { staleReason: reason } : {}),
        suggestions: answer.suggestions.map((s) => (s.question === "interest" ? { ...s, value: previewTagId(s.value) } : s)),
      });
      const outOfCredits = MOCK_CREDIT_ALLOWANCE - used < MOCK_CREDIT_COSTS.suggest;
      if (computing) {
        if (outOfCredits) {
          if (refresh) throw new ApiError("resource-exhausted", "You have used this month’s Dipbot credits.", {}, "AI_CREDITS_EXHAUSTED");
          return shape(now().getTime(), "computed", 0, used, undefined, mockSuggestions(aiScenario() === "nodata" ? "none" : "heuristic"));
        }
        const ai = aiLoad();
        ai.credits = { ...ai.credits, [session.companyId]: used + MOCK_CREDIT_COSTS.suggest };
        aiSave(ai);
        savedSuggest.at = now().getTime();
        return shape(savedSuggest.at, "computed", MOCK_CREDIT_COSTS.suggest, used + MOCK_CREDIT_COSTS.suggest);
      }
      if (savedSuggest.at !== null) return shape(savedSuggest.at, "fresh", 0, used);
      const hours = 60 * 60_000;
      if (cache === "stale") return shape(now().getTime() - 72 * hours, "stale", 0, used, "data");
      if (cache === "age") return shape(now().getTime() - 9 * 24 * hours, "stale", 0, used, "age");
      return shape(now().getTime() - 2 * hours, "fresh", 0, used);
    },
    // Local stand-in for getDipbotIdeasV1 (`?ideas=` picks a scenario). Same policy as the server: `load` is free and instant,
    // `auto` is the one background run (only when due), `refresh` costs 3 credits, needs a requestId and replays by it.
    async dipbotIdeas(input): Promise<DipbotIdeas> {
      const session = staff("ai.generate");
      const scenario = ideasScenarioFromSearch(typeof window === "undefined" ? "" : window.location.search);
      const cost = MOCK_CREDIT_COSTS.ideas;
      const used = () => (scenario === "exhausted" ? MOCK_CREDIT_ALLOWANCE : aiCreditsUsed(session.companyId));
      const ran = () => ideasRun.at !== null;
      const shape = (over: Partial<DipbotIdeas> = {}, charged = 0): DipbotIdeas => {
        const ideas = buildMockIdeas(!ran() && (scenario === "computing" || scenario === "empty") ? "starter" : "stored", ideasRun.generation, now())
          .map((i) => ({ ...i, tagIds: i.tagIds.map(previewTagId), choices: { ...i.choices, focusTagIds: i.choices.focusTagIds.map(previewTagId) } }));
        const hours = 60 * 60_000;
        const generatedAt = ran() ? new Date(ideasRun.at!).toISOString() : ideas[0]?.source === "catalog" ? undefined : new Date(now().getTime() - (scenario === "fresh" ? 2 : 26) * hours).toISOString();
        return {
          enabled: scenario !== "off" && aiScenario() !== "off", ideas,
          status: ideas[0]?.source === "catalog" ? "fallback" : ran() || scenario === "fresh" ? "fresh" : "stale",
          ...(generatedAt ? { generatedAt } : {}),
          dataLevel: scenario === "empty" ? "none" : scenario === "computing" ? "some" : "rich",
          autoRefreshDue: scenario === "computing" && !ideasRun.autoDone,
          refreshesLeftToday: scenario === "limit" ? 0 : Math.max(0, 3 - ideasRun.refreshes),
          credits: creditsOf(used(), now()), creditsCharged: charged, ...over,
        };
      };
      if (scenario === "off" || aiScenario() === "off") return { ...shape(), enabled: false, ideas: [] };
      if (input.mode === "load") {
        await aiDelay(450);
        if (scenario === "error") throw new ApiError("failed-precondition", "Ideas are not available right now.", {}, "AI_UNAVAILABLE");
        return shape();
      }
      if (input.mode === "auto") {
        await aiDelay(1200);
        if (!shape().autoRefreshDue || MOCK_CREDIT_ALLOWANCE - used() < cost) return shape({ outcome: "skipped" });
        return runIdeas(session.companyId, used(), 0, "updated");
      }
      if (!input.requestId) throw new ApiError("invalid-argument", "Refresh needs a request id.", { requestId: "Required." });
      const replay = ideasRun.receipts.get(input.requestId);
      await aiDelay(replay ? 300 : 1400);
      if (replay) return { ...replay, outcome: "unchanged", creditsCharged: 0 };
      if (scenario === "limit" || ideasRun.refreshes >= 3) throw new ApiError("resource-exhausted", "You have used today’s idea refreshes.", {}, "AI_IDEAS_REFRESH_LIMIT");
      if (MOCK_CREDIT_ALLOWANCE - used() < cost) throw new ApiError("resource-exhausted", "You have used this month’s Dipbot credits.", {}, "AI_CREDITS_EXHAUSTED");
      if (scenario === "error") throw new ApiError("failed-precondition", "Ideas are not available right now.", {}, "AI_UNAVAILABLE");
      const result = runIdeas(session.companyId, used(), 1, "updated", input.requestId);
      return result;

      /** Spends the credits, stores the next set and answers with it (the fresh set is what the server stored). */
      function runIdeas(companyId: string, before: number, refreshes: 0 | 1, outcome: "updated", requestId?: string): DipbotIdeas {
        const ai = aiLoad();
        ai.credits = { ...ai.credits, [companyId]: before + cost };
        aiSave(ai);
        ideasRun.generation += 1;
        ideasRun.at = now().getTime();
        ideasRun.refreshes += refreshes;
        ideasRun.autoDone = true;
        const out: DipbotIdeas = { ...shape({ outcome }, cost), credits: creditsOf(before + cost, now()) };
        if (requestId) ideasRun.receipts.set(requestId, out);
        return out;
      }
    },
    // Local stand-in for suggestThemeV1 (`?themeSuggest=` picks a scenario). Same policy as the server: 2 credits when a
    // "model" answered, free for the catalog fallback, replayed free by requestId, refused before any work without credits.
    async suggestTheme(input): Promise<SuggestThemeResult> {
      const session = staff("ai.generate");
      const scenario = themeSuggestScenarioFromSearch(typeof window === "undefined" ? "" : window.location.search);
      if (aiScenario() === "off") throw new ApiError("failed-precondition", "Theme suggestions are turned off for this company.", {}, "AI_THEME_SUGGEST_DISABLED");
      const replay = themeRuns.receipts.get(input.requestId);
      await aiDelay(replay ? 300 : scenario === "slow" ? 6000 : 1400);
      if (replay) return { ...replay, replay: true, creditsCharged: 0 };
      const cost = MOCK_CREDIT_COSTS.themeSuggest;
      if (MOCK_CREDIT_ALLOWANCE - aiCreditsUsed(session.companyId) < cost) throw new ApiError("resource-exhausted", "This company has used this month's Dipbot credits.", {}, "AI_CREDITS_EXHAUSTED");
      if (scenario === "limit") throw new ApiError("resource-exhausted", "You have used today's theme suggestions. Try again tomorrow.", {}, "AI_THEME_SUGGEST_LIMIT");
      if (scenario === "busy") throw Object.assign(new Error("unavailable [503]"), { name: "FirebaseError", code: "functions/unavailable" });
      if (scenario === "error") throw Object.assign(new Error("internal"), { name: "FirebaseError", code: "functions/internal" });
      if (input.hint && /@|https?:/i.test(input.hint)) throw new ApiError("invalid-argument", "Leave out links, email addresses and phone numbers.", { hint: "Leave out links, email addresses and phone numbers." }, "AI_PROMPT_REJECTED");
      const list = buildMockThemeSuggestions(scenario, input.locale === "es" ? "es" : "en", themeRuns.generation, now())
        .map((s) => ({ ...s, tagIds: s.tagIds.map(previewTagId) }));
      themeRuns.generation += 1;
      const charged = scenario === "fallback" ? 0 : cost;
      const before = aiCreditsUsed(session.companyId);
      if (charged > 0) {
        const ai = aiLoad();
        ai.credits = { ...ai.credits, [session.companyId]: before + charged };
        aiSave(ai);
      }
      const out: SuggestThemeResult = {
        suggestion: list[0]!, alternatives: list.slice(1, 4), outcome: charged > 0 ? "suggested" : "fallback", replay: false,
        credits: creditsOf(before + charged, now()), creditsCharged: charged,
      };
      themeRuns.receipts.set(input.requestId, out);
      return out;
    },
    // Local stand-in for pickEventCoverV1: the deterministic lexical pick. No model answers, so the 1 credit the server
    // charges is refunded: the mock checks the balance (`?ai=nocredits` shows the exhausted state) and leaves it unchanged.
    async pickEventCover(input): Promise<PickEventCoverResult> {
      const session = staff("events.manage");
      const title = input.title.trim();
      if (title.length < 1 || title.length > 120) throw new ApiError("invalid-argument", "Add a title (up to 120 characters) first.", { title: "Add a title first." });
      await aiDelay(350);
      if (MOCK_CREDIT_ALLOWANCE - aiCreditsUsed(session.companyId) < MOCK_CREDIT_COSTS.coverPick) {
        throw new ApiError("resource-exhausted", "You have used this month’s Dipbot credits.", {}, "AI_CREDITS_EXHAUSTED");
      }
      input = { ...input, tagIds: input.tagIds?.map(bundledTagId) };
      const pick = lexicalPick(input, input.excludeCoverImageURLs ?? []);
      const alternatives = [lexicalPick(input, [...(input.excludeCoverImageURLs ?? []), pick.url]).url].filter((url) => url !== pick.url);
      return { coverImageURL: pick.url, source: "match", provider: null, alternatives };
    },
    // ----- Smart location (preview scenarios: ?office=unset starts without an office; ?venues=empty, error, limit)
    async companyOffice(): Promise<CompanyOffice | null> {
      const session = staff("events.manage");
      const saved = readOffice(session.companyId);
      if (saved) return saved;
      const unset = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("office") === "unset";
      return unset ? null : MOCK_OFFICE;
    },
    async setCompanyOffice({ placeId }): Promise<CompanyOffice> {
      const session = staff("ai.generate");
      await aiDelay(250);
      placesScenario();
      const place = fakeResolve({ placeId });
      if (!place) throw new ApiError("invalid-argument", "Pick an office address from the suggestions.", { placeId: "Pick an address." }, "VALIDATION_FAILED");
      const saved: CompanyOffice = { address: place.address, locality: place.locality, latitude: place.latitude, longitude: place.longitude };
      store.setItem(OFFICE_KEY, JSON.stringify({ ...officeMap(), [session.companyId]: saved }));
      return saved;
    },
    // Local stand-ins for autocompletePlacesV1 / resolvePlaceV1 (canned Pittsburgh places; scenarios ?places=disabled|limit|notfound).
    async autocompletePlaces(input) {
      staff("events.manage");
      await aiDelay(150);
      placesScenario();
      return fakeAutocomplete(input.slice(0, 120));
    },
    async resolvePlace(request) {
      staff("events.manage");
      await aiDelay(150);
      const scenario = placesScenario();
      if (scenario === "notfound" && "query" in request) return null;
      return fakeResolve(request);
    },
    // Local stand-in for findVenuesV1: four to five fixed Pittsburgh venues, 1 credit, replayed free for the same requestId.
    async findVenues(input) {
      const session = staff("ai.generate");
      const scenario = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("venues");
      const office = readOffice(session.companyId) ?? (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("office") === "unset" ? null : MOCK_OFFICE);
      if (!office) throw new ApiError("failed-precondition", "Set your office address first.", {}, "OFFICE_NOT_SET");
      if (!input.title.trim()) throw new ApiError("invalid-argument", "Add a title first.", { title: "Add a title first." }, "VALIDATION_FAILED");
      if (aiScenario() === "off") throw new ApiError("failed-precondition", "Venue search is off.", {}, "AI_VENUES_DISABLED");
      await aiDelay(scenario === "slow" ? 6000 : 900);
      const cost = MOCK_CREDIT_COSTS.venueSearch;
      if (MOCK_CREDIT_ALLOWANCE - aiCreditsUsed(session.companyId) < cost) throw new ApiError("resource-exhausted", "You have used this month’s Dipbot credits.", {}, "AI_CREDITS_EXHAUSTED");
      if (scenario === "limit") throw new ApiError("resource-exhausted", "Too many venue searches today.", {}, "VENUE_SEARCH_LIMIT");
      if (scenario === "error") throw new Error("Venue search failed.");
      const radiusMiles = input.radiusMiles ?? 5;
      const venues = scenario === "empty" ? [] : mockVenues(input, office);
      const ai = aiLoad();
      const seen = ai.venueRequests ?? [];
      const replay = seen.includes(input.requestId);
      if (!replay && venues.length > 0) {
        ai.credits = { ...ai.credits, [session.companyId]: aiCreditsUsed(session.companyId) + cost };
        ai.venueRequests = [...seen, input.requestId].slice(-50);
        aiSave(ai);
      }
      return { venues, provider: "google", cached: replay, charged: !replay && venues.length > 0, radiusMiles, office };
    },

    // Local stand-in for searchCoverPhotosV1: there is no Pixabay offline, so the search reports "unavailable". No network.
    async searchCoverPhotos(): Promise<SearchCoverPhotosResult> {
      staff("ai.generate");
      await aiDelay(250);
      return { candidates: [], status: "unavailable" };
    },
    async importCoverPhoto(): Promise<ImportCoverPhotoResult> {
      staff("ai.generate");
      throw new ApiError("failed-precondition", "More photos are not available in the demo.", {}, "COVER_SEARCH_UNAVAILABLE");
    },
    async generateEventDrafts(input): Promise<GenerateDraftsResult> {
      const session = staff("ai.generate");
      const scenario = aiScenario();
      const ai = aiLoad();
      const receiptKey = `${session.companyId}:${session.uid}:${input.requestId}`;
      const replayed = ai.receipts[receiptKey];
      if (replayed) {
        await aiDelay(300);
        return previewDrafts({ ...replayed, replay: true });
      }
      await aiDelay(scenario === "slow" ? 8000 : 900);
      if (scenario === "off") throw new ApiError("failed-precondition", `${t("off.title")}.`, {}, "AI_DISABLED");
      if (input.prompt.length > 500) throw new ApiError("invalid-argument", "Keep the note under 500 characters.", { prompt: "Keep the note under 500 characters." }, "AI_PROMPT_REJECTED");
      if (promptRejected(input.prompt)) {
        throw new ApiError("invalid-argument", "That note can’t be used. Describe the event you want instead.", { prompt: "That note can’t be used. Describe the event you want instead." }, "AI_PROMPT_REJECTED");
      }
      if (input.count < 1 || input.count > 3) throw new ApiError("invalid-argument", "Ask for 1 to 3 drafts.", { count: "Ask for 1 to 3 drafts." });
      if (scenario === "error") throw new ApiError("failed-precondition", "The AI service is busy right now. Try again in a moment.", {}, "AI_UNAVAILABLE");
      const { monthly, daily } = aiUsage(session.companyId);
      if (scenario === "quota" || daily >= MOCK_DAILY_LIMIT) throw new ApiError("resource-exhausted", "You have used today’s AI drafts.", {}, "AI_DAILY_LIMIT");
      if (monthly >= MOCK_MONTHLY_LIMIT) throw new ApiError("resource-exhausted", "You have used this month’s AI drafts.", {}, "AI_MONTHLY_LIMIT");
      const used = aiCreditsUsed(session.companyId);
      if (MOCK_CREDIT_ALLOWANCE - used < MOCK_CREDIT_COSTS.generate) {
        throw new ApiError("resource-exhausted", "You have used this month’s Dipbot credits.", {}, "AI_CREDITS_EXHAUSTED");
      }
      ai.usage[session.companyId] = { monthly: monthly + 1, daily: daily + 1 };
      ai.credits = { ...ai.credits, [session.companyId]: used + MOCK_CREDIT_COSTS.generate };
      const choices = { ...input.choices, focusTagIds: input.choices.focusTagIds.map(bundledTagId) };
      const result: GenerateDraftsResult = {
        drafts: buildMockDrafts(choices, input.prompt, input.count), usage: usageOf(monthly + 1, daily + 1), credits: creditsOf(used + MOCK_CREDIT_COSTS.generate, now()), replay: false,
      };
      ai.receipts[receiptKey] = result;
      aiSave(ai);
      return previewDrafts(result);
    },

    // ----- tag interest counts (preview scenarios: ?tagstats=empty, ?tagstats=denied)
    async tagStats() {
      const session = staff("insights.view");
      const scenario = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tagstats");
      if (scenario === "denied") return null;
      return mockTagStats(session.companyId, scenario === "empty").map((stat) => ({ ...stat, tagId: previewTagId(stat.tagId) }));
    },

    // ----- audit
    async companyInsights() {
      const session = staff("insights.view");
      const scenario = typeof window === "undefined" ? "default" : scenarioFromSearch(window.location.search);
      if (scenario === "slow") await new Promise((resolve) => setTimeout(resolve, 2500));
      if (scenario === "error") throw new ApiError("failed-precondition", "Couldn’t load the overview. Check your connection and try again.", {}, "UNAVAILABLE");
      const state = load();
      const nowDate = now();
      const theme = deps.themes(session.companyId).find((t) => Date.parse(t.startDate) <= nowDate.getTime() && Date.parse(t.endDate) >= nowDate.getTime()) ?? null;
      // Reviews stay open after a week ends, so the total spans this week and past weeks.
      const started = deps.themes(session.companyId).filter((t) => Date.parse(t.startDate) <= nowDate.getTime()).sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate));
      // Count the stored review queue, seeding this week's theme and the most recent past one the way Review submissions
      // does on first open, so the Overview and the review pages agree (the usability study saw "4 to review" next to
      // "13 pending"). Older themes count once someone opens them.
      state.submissions ??= [];
      state.seededThemes ??= [];
      const latestPast = started.find((t) => t.id !== theme?.id);
      for (const t of [theme, latestPast]) {
        if (!t) continue;
        if (state.seededThemes.includes(`${session.companyId}:${t.id}`)) continue;
        state.seededThemes.push(`${session.companyId}:${t.id}`);
        seedSubmissions(state, session.companyId, t, nowDate);
      }
      save(state);
      const openReviews = started.map((t) => ({
        challengeId: t.id, title: t.title, startDate: t.startDate, endDate: t.endDate,
        count: state.submissions!.filter((s) => s.companyId === session.companyId && s.challengeId === t.id && s.status === "submitted").length,
      })).filter((r) => r.count > 0);
      return buildMockInsights({
        members: state.members.filter((m) => m.companyId === session.companyId),
        invited: state.roster.filter((r) => r.companyId === session.companyId && r.state === "invited").length,
        events: deps.events(session.companyId),
        photos: state.photos.filter((p) => p.companyId === session.companyId).length,
        comments: state.comments.filter((c) => c.companyId === session.companyId).length,
        theme,
        pendingReviews: openReviews.find((r) => r.challengeId === theme?.id)?.count ?? 0,
        openReviews,
      }, scenario, session.role, nowDate);
    },

    // ----- audit
    async listAudit() {
      const state = load();
      const session = staff("audit.view");
      return state.audit.filter((a) => a.companyId === session.companyId).map((a) => strip(a)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    },

    // The mock keeps the language in this browser only (localStorage, set by the Language setting): nothing to save.
    async setMyLocale() {},

    // ----- opt-in emails: the signed-in person's own switches, kept in this browser
    async emailSwitches() {
      const session = deps.session();
      if (!session) throw new ApiError("unauthenticated", "Sign in to continue.", {}, "UNAUTHENTICATED");
      return emailSwitchesFrom(load().emailSwitches?.[session.uid]);
    },
    async setEmailSwitch(name, on) {
      const session = deps.session();
      if (!session) throw new ApiError("unauthenticated", "Sign in to continue.", {}, "UNAUTHENTICATED");
      const state = load();
      state.emailSwitches ??= {};
      state.emailSwitches[session.uid] = { ...state.emailSwitches[session.uid], [name]: on };
      save(state);
      return emailSwitchesFrom(state.emailSwitches[session.uid]);
    },
  };
}
