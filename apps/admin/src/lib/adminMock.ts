import type { AdminOpsApi } from "./adminApi";
import {
  type AlbumComment, type AlbumPhoto, type ApplyRowResult, type Attendee, type AuditEntry, type Capability, type CompanyInfo,
  type FieldChange, type ImportPlanResponse, type ImportRow, type Member, type PlanAction, type Role, type RosterRow,
  IMPORT_FIELDS, IMPORT_LIMITS, can,
} from "./adminTypes";
import type { KeyValueStore, Session } from "./api";
import { ApiError } from "./contract";
import { validateRow } from "./importFile";

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
  companies: Record<string, CompanyInfo>;
  members: StoredMember[];
  roster: StoredRoster[];
  photos: Stored<AlbumPhoto>[];
  comments: Stored<AlbumComment & { eventId: string }>[];
  attendees: Record<string, Attendee[]>; // `${companyId}:${eventId}`
  audit: Stored<AuditEntry>[];
  receipts: Record<string, string>;
  jobs: Record<string, Job>;
}

const KEY = "dip-admin-mock-ops-v2";
const TEAMS = ["Platform", "Mentors", "Wellness", "Events crew", "Design"];
const LOCATIONS = ["Pittsburgh", "Philadelphia", "New York", "Remote"];
const DEPARTMENTS = ["Engineering", "People", "Marketing", "Finance", "Operations"];
const FIRST = ["Alex", "Pat", "Casey", "Riley", "Sam", "Jordan", "Morgan", "Taylor", "Avery", "Quinn", "Jamie", "Robin", "Drew", "Skyler", "Cameron", "Reese", "Emery", "Harper", "Rowan", "Sage", "Blake", "Dana", "Kai", "Lee"];
const LAST = ["Admin", "Member", "Novak", "Chen", "Okafor", "Rivera", "Patel", "Haas", "Kim", "Silva", "Brandt", "Costa", "Dubois", "Evans", "Fischer", "Gupta", "Hughes", "Ito", "Jensen", "Khan", "Lopez", "Mendes", "Nair", "Ortiz"];

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const isoAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

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
      avatarId: `avatar-${(i % 8) + 1}`, city: LOCATIONS[i % 4], revision: 1,
    };
  });
  members.push({
    companyId: "globex", id: "uid-other-admin", email: "gale@globex.com", displayName: "Gale Globex", role: "admin", teamIds: [],
    workLocation: "Remote", department: "Operations", jobTitle: "Director", status: "active", pointsBalance: 0, createdAt: isoAgo(now, 90),
    avatarId: "avatar-1", city: "Remote", revision: 1,
  });
  const invite = (first: string, last: string, days: number, teamIndex: number): StoredRoster => ({
    companyId: "acme", entryId: `${slug(first)}.${slug(last)}@acme.com`, email: `${slug(first)}.${slug(last)}@acme.com`, displayName: `${first} ${last}`, role: "member",
    teamIds: [teams[teamIndex].id], workLocation: LOCATIONS[teamIndex % 4], department: DEPARTMENTS[teamIndex % 5], jobTitle: "Specialist",
    managerEmail: "", startDate: "", state: "invited", invitedAt: isoAgo(now, days),
  });
  const roster: StoredRoster[] = [invite("Nico", "Farrow", 12, 0), invite("Priya", "Shah", 5, 2), invite("Tomas", "Reyes", 2, 4), { ...invite("Lena", "Marsh", 30, 1), state: "revoked" }];
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
      storagePath: `companies/acme/events/game-cafe/photos/${uploader.id}/${i}`, previewImage: `/img/events/${images[i % 5]}.jpg`,
    });
    for (let c = 0; c < count; c += 1) {
      const author = members[(i + c * 5 + 2) % 20];
      comments.push({
        companyId: "acme", eventId: "game-cafe", id: `c-${i}-${c}`, photoId: id, authorId: author.id, authorName: author.displayName,
        text: c ? "We should do this again next month." : "Love this one!", createdAt: isoAgo(now, 12.8 - i * 0.3 - c * 0.1),
      });
    }
  }
  return { companies, members, roster, photos, comments, attendees: {}, audit: [], receipts: {}, jobs: {} };
}

const hashOf = (value: unknown) => {
  // A stand-in for the server's SHA-256 plan hash: stable for equal rows, 64 hex characters.
  const text = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8);
};

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
          memberId: m.id, name: m.displayName, email: m.email, department: m.department, jobTitle: m.jobTitle,
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
      return photo.previewImage ?? "/img/events/games.jpg";
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
      list.push({ memberId: m.id, name: m.displayName, email: m.email, department: m.department, jobTitle: m.jobTitle, rsvpAt: now().toISOString(), checkedIn: false, addedByAdmin: true });
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
      Object.assign(m, { avatarId: "", city: "", revision: m.revision + 1 });
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
    async listRoster() {
      const state = load();
      const session = staff("roster.manage");
      const entries = state.roster.filter((r) => r.companyId === session.companyId).map((r) => strip(r));
      // People who already have an account appear through their member record.
      const people = state.members.filter((m) => m.companyId === session.companyId).map((m): RosterRow => ({
        entryId: m.id, email: m.email, displayName: m.displayName, role: m.role, teamIds: m.teamIds, workLocation: m.workLocation, department: m.department,
        jobTitle: m.jobTitle, managerEmail: "", startDate: "", state: m.status === "deactivated" ? "deactivated" : "active", memberId: m.id, invitedAt: m.createdAt,
      }));
      return [...entries, ...people].sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
    async revokeRosterEntry(entryId) {
      const state = load();
      const session = staff("roster.manage");
      const entry = state.roster.find((r) => r.companyId === session.companyId && r.entryId === entryId);
      if (!entry) throw new ApiError("not-found", "That person isn’t on the roster.", {}, "ROSTER_ENTRY_NOT_FOUND");
      if (entry.state === "revoked") return;
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

    // ----- audit
    async listAudit() {
      const state = load();
      const session = staff("audit.view");
      return state.audit.filter((a) => a.companyId === session.companyId).map((a) => strip(a)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    },
  };
}
