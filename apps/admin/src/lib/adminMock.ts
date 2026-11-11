import type { AdminOpsApi } from "./adminApi";
import {
  type AlbumComment, type AlbumPhoto, type ApplyRowResult, type Attendee, type AuditEntry, type Capability, type CompanyInfo,
  type FieldChange, type ImportField, type ImportRow, type Member, type PlanRow, type RosterRow, type Role,
  IMPORT_FIELDS, IMPORT_LIMITS, can,
} from "./adminTypes";
import type { KeyValueStore, Session } from "./api";
import { ApiError } from "./contract";
import { validateRow } from "./importFile";

/** What the ops mock needs to know about an event; supplied by createMockApi so counts stay consistent. */
export interface MockEventView {
  id: string; title: string; capacity: number; attendeeCount: number; endTime: string; status: string;
}
export interface MockOpsDeps {
  store: KeyValueStore;
  now: () => Date;
  session: () => Session | null;
  findEvent: (companyId: string, eventId: string) => MockEventView | undefined;
  bumpAttendees: (companyId: string, eventId: string, delta: number) => number;
}

type Stored<T> = T & { companyId: string };
interface RosterExtra { managerEmail: string; startDate: string }
interface Job { companyId: string; plans: Record<number, { rows: ImportRow[]; lines: number[] }>; applied: Record<number, ApplyRowResult[]> }
interface OpsState {
  companies: Record<string, CompanyInfo>;
  members: Stored<Member>[];
  roster: Stored<RosterRow & RosterExtra>[];
  photos: Stored<AlbumPhoto>[];
  comments: Stored<AlbumComment & { eventId: string }>[];
  attendees: Record<string, Attendee[]>; // `${companyId}:${eventId}`
  audit: Stored<AuditEntry>[];
  receipts: Record<string, string>;
  jobs: Record<string, Job>;
}

const KEY = "dip-admin-mock-ops-v1";
const TEAMS = ["Platform", "Mentors", "Wellness", "Events crew", "Design"];
const LOCATIONS = ["Pittsburgh", "Philadelphia", "New York", "Remote"];
const DEPARTMENTS = ["Engineering", "People", "Marketing", "Finance", "Operations"];
const FIRST = ["Alex", "Pat", "Jordan", "Riley", "Sam", "Casey", "Morgan", "Taylor", "Avery", "Quinn", "Jamie", "Robin", "Drew", "Skyler", "Cameron", "Reese", "Emery", "Harper", "Rowan", "Sage", "Blake", "Dana", "Kai", "Lee"];
const LAST = ["Admin", "Member", "Rivera", "Chen", "Okafor", "Novak", "Patel", "Haas", "Kim", "Silva", "Brandt", "Costa", "Dubois", "Evans", "Fischer", "Gupta", "Hughes", "Ito", "Jensen", "Khan", "Lopez", "Mendes", "Nair", "Ortiz"];

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function isoAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export function seedOps(now: Date): OpsState {
  const teams = TEAMS.map((name) => ({ id: `team-${slug(name)}`, name }));
  const companies: Record<string, CompanyInfo> = {
    acme: { id: "acme", name: "Acme", emailDomain: "acme.com", teams },
    globex: { id: "globex", name: "Globex", emailDomain: "globex.com", teams },
  };
  const members: Stored<Member>[] = FIRST.map((first, i) => {
    const last = LAST[i];
    const role: Role = i === 0 ? "admin" : i === 2 ? "organizer" : "member";
    return {
      companyId: "acme", id: i === 0 ? "uid-admin" : i === 1 ? "uid-member" : `uid-${slug(first)}-${slug(last)}`,
      email: `${slug(first)}.${slug(last)}@acme.com`.replace("alex.admin@", "alex@").replace("pat.member@", "pat@"),
      displayName: `${first} ${last}`, role, teamIds: [teams[i % 5].id, ...(i % 4 === 0 ? [teams[(i + 2) % 5].id] : [])],
      workLocation: LOCATIONS[i % 4], department: DEPARTMENTS[i % 5], jobTitle: i % 3 === 0 ? "Manager" : "Specialist",
      status: i === 20 ? "deactivated" : "active", pointsBalance: (i * 137) % 900, createdAt: isoAgo(now, 200 - i * 6),
      interestTagIds: i % 2 ? ["tag-fitness", "tag-games"] : ["tag-cooking"], avatarId: `avatar-${(i % 8) + 1}`,
      city: LOCATIONS[i % 4], favoriteCount: i % 5, revision: 1,
    };
  });
  members.push({
    companyId: "globex", id: "uid-other-admin", email: "gale@globex.com", displayName: "Gale Globex", role: "admin", teamIds: [],
    workLocation: "Remote", department: "Operations", jobTitle: "Director", status: "active", pointsBalance: 0, createdAt: isoAgo(now, 90),
    interestTagIds: [], avatarId: "avatar-1", city: "Remote", favoriteCount: 0, revision: 1,
  });
  const invite = (first: string, last: string, days: number, teamIndex: number): Stored<RosterRow & RosterExtra> => ({
    companyId: "acme", email: `${slug(first)}.${slug(last)}@acme.com`, displayName: `${first} ${last}`, role: "member",
    teamIds: [teams[teamIndex].id], workLocation: LOCATIONS[teamIndex % 4], department: DEPARTMENTS[teamIndex % 5], jobTitle: "Specialist",
    state: "invited", invitedAt: isoAgo(now, days), lastInvitedAt: isoAgo(now, days), inviteCount: 1, managerEmail: "", startDate: "",
  });
  const roster: Stored<RosterRow & RosterExtra>[] = [
    invite("Nico", "Farrow", 12, 0), invite("Priya", "Shah", 5, 2), invite("Tomas", "Reyes", 2, 4),
    ...members.filter((m) => m.companyId === "acme").map((m): Stored<RosterRow & RosterExtra> => ({
      companyId: "acme", email: m.email, displayName: m.displayName, role: m.role, teamIds: m.teamIds, workLocation: m.workLocation,
      department: m.department, jobTitle: m.jobTitle, state: m.status === "deactivated" ? "deactivated" : "active", memberId: m.id,
      invitedAt: m.createdAt, lastInvitedAt: m.createdAt, inviteCount: 1, managerEmail: "", startDate: "",
    })),
  ];
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
    if (!session) throw new ApiError("unauthenticated", "Sign in to continue.");
    if (!can(session.role, capability)) throw new ApiError("permission-denied", "Your role can’t do this.", {}, "NOT_PERMITTED");
    return session;
  }
  const log = (state: OpsState, session: Session, entry: Omit<AuditEntry, "id" | "at" | "actorId" | "actorName">) => {
    state.audit.push({ ...entry, companyId: session.companyId, id: `aud-${state.audit.length + 1}-${now().getTime()}`, at: now().toISOString(), actorId: session.uid, actorName: session.name });
  };
  const strip = <T extends { companyId: string }>(item: T): Omit<T, "companyId"> => {
    const { companyId: _ignored, ...rest } = item;
    void _ignored;
    return rest;
  };
  const company = (state: OpsState, session: Session) => state.companies[session.companyId];
  const teamNames = (state: OpsState, session: Session, ids: string[]) =>
    ids.map((id) => company(state, session).teams.find((t) => t.id === id)?.name ?? id).join("; ");

  function member(state: OpsState, session: Session, id: string): Stored<Member> {
    const found = state.members.find((m) => m.id === id && m.companyId === session.companyId);
    if (!found) throw new ApiError("not-found", "That member doesn’t exist.", {}, "MEMBER_NOT_FOUND");
    return found;
  }
  const admins = (state: OpsState, session: Session) => state.members.filter((m) => m.companyId === session.companyId && m.role === "admin" && m.status === "active");
  function syncRoster(state: OpsState, m: Stored<Member>) {
    const entry = state.roster.find((r) => r.companyId === m.companyId && r.email === m.email);
    if (entry) Object.assign(entry, { displayName: m.displayName, role: m.role, teamIds: m.teamIds, workLocation: m.workLocation, department: m.department, jobTitle: m.jobTitle, state: m.status === "deactivated" ? "deactivated" : "active", memberId: m.id });
  }

  // ----- import planning (mirrors importEmployeesV1)
  function currentValues(state: OpsState, session: Session, email: string): Record<ImportField, string> | null {
    const m = state.members.find((x) => x.companyId === session.companyId && x.email === email);
    const r = state.roster.find((x) => x.companyId === session.companyId && x.email === email);
    const source = m ?? r;
    if (!source) return null;
    return {
      email, displayName: source.displayName, role: source.role, teams: teamNames(state, session, source.teamIds), department: source.department,
      jobTitle: source.jobTitle, workLocation: source.workLocation, managerEmail: r?.managerEmail ?? "", startDate: r?.startDate ?? "",
    };
  }
  function planRow(state: OpsState, session: Session, row: ImportRow, line: number): PlanRow {
    const info = company(state, session);
    const errors = validateRow(row, info.emailDomain);
    const teamIds: string[] = [];
    for (const name of row.teams) {
      const team = info.teams.find((t) => t.id === name || t.name.toLowerCase() === name.toLowerCase());
      if (team) teamIds.push(team.id); else errors.push(`Unknown team “${name}”.`);
    }
    const current = currentValues(state, session, row.email);
    if (!current && !row.displayName) errors.push("New people need a name.");
    if (current && row.role !== "" && row.role !== "admin" && current.role === "admin" && admins(state, session).length <= 1 && admins(state, session).some((a) => a.email === row.email)) errors.push("This would remove the last admin.");
    if (errors.length) return { line, email: row.email, action: "invalid", changes: [], errors };
    const wanted: Record<ImportField, string> = { ...row, role: row.role || (current ? "" : "member"), teams: teamIds.map((id) => info.teams.find((t) => t.id === id)!.name).join("; ") } as unknown as Record<ImportField, string>;
    if (!current) {
      return { line, email: row.email, action: "create", errors: [], changes: IMPORT_FIELDS.filter((f) => f !== "email" && wanted[f]).map((field) => ({ field, before: "", after: wanted[field] })) };
    }
    // Blank cells keep the current value; only filled cells change anything.
    const changes: FieldChange[] = IMPORT_FIELDS.filter((f) => f !== "email" && wanted[f] && wanted[f] !== current[f]).map((field) => ({ field, before: current[field], after: wanted[field] }));
    return { line, email: row.email, action: changes.length ? "update" : "unchanged", changes, errors: [] };
  }
  function applyPlanned(state: OpsState, session: Session, row: ImportRow, plan: PlanRow): ApplyRowResult {
    const base = { line: plan.line, email: row.email };
    if (plan.action === "invalid") return { ...base, outcome: "failed", error: plan.errors.join(" ") };
    if (plan.action === "unchanged") return { ...base, outcome: "unchanged" };
    const info = company(state, session);
    const ids = row.teams.map((name) => info.teams.find((t) => t.id === name || t.name.toLowerCase() === name.toLowerCase())?.id).filter((x): x is string => !!x);
    const existingMember = state.members.find((m) => m.companyId === session.companyId && m.email === row.email);
    const entry = state.roster.find((r) => r.companyId === session.companyId && r.email === row.email);
    const patch = {
      ...(row.displayName ? { displayName: row.displayName } : {}), ...(row.role ? { role: row.role } : existingMember || entry ? {} : { role: "member" as Role }), ...(ids.length ? { teamIds: ids } : {}),
      ...(row.department ? { department: row.department } : {}), ...(row.jobTitle ? { jobTitle: row.jobTitle } : {}),
      ...(row.workLocation ? { workLocation: row.workLocation } : {}),
    };
    if (existingMember) {
      Object.assign(existingMember, patch, { revision: existingMember.revision + 1 });
      syncRoster(state, existingMember);
    }
    if (entry) Object.assign(entry, existingMember ? {} : patch, { managerEmail: row.managerEmail || entry.managerEmail, startDate: row.startDate || entry.startDate });
    else {
      state.roster.push({
        companyId: session.companyId, email: row.email, displayName: row.displayName, role: row.role || "member", teamIds: ids, workLocation: row.workLocation,
        department: row.department, jobTitle: row.jobTitle, state: "invited", invitedAt: now().toISOString(), lastInvitedAt: now().toISOString(),
        inviteCount: 1, managerEmail: row.managerEmail, startDate: row.startDate,
      });
    }
    return { ...base, outcome: plan.action === "create" ? "created" : "updated" };
  }

  function attendeeKey(session: Session, eventId: string) { return `${session.companyId}:${eventId}`; }
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
          rsvpAt: isoAgo(now(), 20 - (i % 10)), attendance: past ? (i % 5 === 4 ? "noShow" : "checkedIn") : "unmarked", addedByAdmin: false,
        };
      });
    }
    return state.attendees[key];
  }

  return {
    async companyInfo() {
      const state = load();
      const session = staff("events.manage");
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
      if (!reason.trim()) throw new ApiError("invalid-argument", "Give a reason.", { reason: "Give a reason." });
      const photo = state.photos.find((p) => p.id === photoId && p.eventId === eventId && p.companyId === session.companyId);
      if (!photo) throw new ApiError("not-found", "That photo was already removed.", {}, "PHOTO_NOT_FOUND");
      state.photos = state.photos.filter((p) => p !== photo);
      state.comments = state.comments.filter((c) => !(c.companyId === session.companyId && c.photoId === photoId));
      log(state, session, { action: "photo.remove", targetType: "photo", targetId: photoId, targetLabel: `Photo by ${photo.uploaderName}`, summary: `Removed a photo and ${photo.commentCount} comments`, reason });
      save(state);
    },
    async removePhotoComment(eventId, photoId, commentId, reason) {
      const state = load();
      const session = staff("albums.moderate");
      if (!reason.trim()) throw new ApiError("invalid-argument", "Give a reason.", { reason: "Give a reason." });
      const comment = state.comments.find((c) => c.id === commentId && c.photoId === photoId && c.eventId === eventId && c.companyId === session.companyId);
      if (!comment) throw new ApiError("not-found", "That comment was already removed.", {}, "COMMENT_NOT_FOUND");
      state.comments = state.comments.filter((c) => c !== comment);
      const photo = state.photos.find((p) => p.id === photoId && p.companyId === session.companyId);
      if (photo) photo.commentCount = Math.max(0, photo.commentCount - 1);
      log(state, session, { action: "comment.remove", targetType: "comment", targetId: commentId, targetLabel: `Comment by ${comment.authorName}`, summary: `Removed a comment on ${photo?.uploaderName ?? "a"}’s photo`, reason });
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
      if (state.receipts[receiptKey]) return { attendeeCount: event.attendeeCount };
      const m = member(state, session, input.memberId);
      if (m.status !== "active") throw new ApiError("failed-precondition", "Only active members can be added.", {}, "MEMBER_NOT_ACTIVE");
      if (event.status === "cancelled") throw new ApiError("failed-precondition", "This event is cancelled.", {}, "EVENT_CANCELLED");
      const list = attendeesOf(state, session, input.eventId);
      if (list.some((a) => a.memberId === m.id)) throw new ApiError("failed-precondition", `${m.displayName} is already going.`, {}, "ALREADY_ATTENDING");
      if (event.attendeeCount >= event.capacity && !input.overrideCapacity) {
        throw new ApiError("failed-precondition", "This event is full. Add the person anyway with a reason.", {}, "EVENT_FULL");
      }
      if (input.overrideCapacity && !input.reason?.trim()) throw new ApiError("invalid-argument", "Give a reason for going over capacity.", { reason: "Give a reason." });
      list.push({ memberId: m.id, name: m.displayName, email: m.email, department: m.department, jobTitle: m.jobTitle, rsvpAt: now().toISOString(), attendance: "unmarked", addedByAdmin: true });
      const count = deps.bumpAttendees(session.companyId, input.eventId, 1);
      state.receipts[receiptKey] = m.id;
      log(state, session, { action: "attendee.add", targetType: "attendee", targetId: m.id, targetLabel: `${m.displayName} at ${event.title}`, summary: `Added ${m.displayName} as going${input.overrideCapacity ? " over capacity" : ""}${input.notify ? ", notified" : ""}`, reason: input.reason });
      save(state);
      return { attendeeCount: count };
    },
    async removeAttendee(eventId, memberId, notify, reason) {
      const state = load();
      const session = staff("attendees.manage");
      const event = deps.findEvent(session.companyId, eventId);
      if (!event) throw new ApiError("not-found", "That event doesn’t exist.", {}, "EVENT_NOT_FOUND");
      const list = attendeesOf(state, session, eventId);
      const found = list.find((a) => a.memberId === memberId);
      if (!found) throw new ApiError("not-found", "That person isn’t on the list.", {}, "ATTENDEE_NOT_FOUND");
      state.attendees[attendeeKey(session, eventId)] = list.filter((a) => a !== found);
      const count = deps.bumpAttendees(session.companyId, eventId, -1);
      log(state, session, { action: "attendee.remove", targetType: "attendee", targetId: memberId, targetLabel: `${found.name} at ${event.title}`, summary: `Cancelled ${found.name}’s RSVP${notify ? ", notified" : ""}`, reason });
      save(state);
      return { attendeeCount: count };
    },
    async setAttendance(eventId, memberId, attendance) {
      const state = load();
      const session = staff("attendees.manage");
      const event = deps.findEvent(session.companyId, eventId);
      if (!event) throw new ApiError("not-found", "That event doesn’t exist.", {}, "EVENT_NOT_FOUND");
      const found = attendeesOf(state, session, eventId).find((a) => a.memberId === memberId);
      if (!found) throw new ApiError("not-found", "That person isn’t on the list.", {}, "ATTENDEE_NOT_FOUND");
      const awarded = attendance === "checkedIn" && found.attendance !== "checkedIn" ? 25 : 0;
      const before = found.attendance;
      found.attendance = attendance;
      if (awarded) {
        const m = state.members.find((x) => x.id === memberId && x.companyId === session.companyId);
        if (m) m.pointsBalance += awarded;
      }
      log(state, session, { action: "attendee.attendance", targetType: "attendee", targetId: memberId, targetLabel: `${found.name} at ${event.title}`, summary: `Marked ${found.name} ${attendance === "checkedIn" ? "checked in" : attendance === "noShow" ? "as a no-show" : "as unmarked"}`, before: { attendance: before }, after: { attendance } });
      save(state);
      return { pointsAwarded: awarded };
    },

    // ----- members
    async listMembers() {
      const state = load();
      const session = staff("attendees.manage"); // organizers read the list for the attendee picker
      return state.members.filter((m) => m.companyId === session.companyId).map((m) => strip(m)).sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
    async getMember(id) {
      const state = load();
      return strip(member(state, staff("members.view"), id));
    },
    async updateMember(id, expectedRevision, patch) {
      const state = load();
      const session = staff("members.edit");
      const m = member(state, session, id);
      if (m.revision !== expectedRevision) throw new ApiError("aborted", "Someone else changed this member. Reload to see their changes.", {}, "REVISION_CONFLICT");
      if (patch.role && patch.role !== "admin" && m.role === "admin" && admins(state, session).length <= 1) {
        throw new ApiError("failed-precondition", "This is the last admin. Make someone else an admin first.", { role: "Last admin." }, "LAST_ADMIN");
      }
      const before: Record<string, string> = {};
      const after: Record<string, string> = {};
      for (const key of ["role", "workLocation", "department", "jobTitle"] as const) {
        const value = patch[key];
        if (value !== undefined && value !== m[key]) { before[key] = m[key]; after[key] = value; (m as unknown as Record<string, string>)[key] = value; }
      }
      if (patch.teamIds && patch.teamIds.join() !== m.teamIds.join()) {
        before.teams = teamNames(state, session, m.teamIds); after.teams = teamNames(state, session, patch.teamIds); m.teamIds = patch.teamIds;
      }
      if (Object.keys(after).length === 0) return strip(m);
      m.revision += 1;
      syncRoster(state, m);
      log(state, session, { action: "member.update", targetType: "member", targetId: m.id, targetLabel: m.displayName, summary: `Edited ${Object.keys(after).join(", ")}`, before, after });
      save(state);
      return strip(m);
    },
    async setMemberStatus(id, status, reason) {
      const state = load();
      const session = staff("members.status");
      if (!reason.trim()) throw new ApiError("invalid-argument", "Give a reason.", { reason: "Give a reason." });
      const m = member(state, session, id);
      if (status === "deactivated") {
        if (m.id === session.uid) throw new ApiError("failed-precondition", "You can’t deactivate yourself.", {}, "SELF_DEACTIVATE");
        if (m.role === "admin" && admins(state, session).length <= 1) throw new ApiError("failed-precondition", "This is the last admin.", {}, "LAST_ADMIN");
      }
      if (m.status === status) return strip(m);
      const before = m.status;
      m.status = status;
      m.revision += 1;
      syncRoster(state, m);
      log(state, session, { action: status === "deactivated" ? "member.deactivate" : "member.reactivate", targetType: "member", targetId: m.id, targetLabel: m.displayName, summary: status === "deactivated" ? "Blocked sign-in and removed from upcoming events" : "Restored access", reason, before: { status: before }, after: { status } });
      save(state);
      return strip(m);
    },
    async resetMemberProfile(id, reason) {
      const state = load();
      const session = staff("members.reset");
      if (!reason.trim()) throw new ApiError("invalid-argument", "Give a reason.", { reason: "Give a reason." });
      const m = member(state, session, id);
      const before = { interests: String(m.interestTagIds.length), favorites: String(m.favoriteCount), avatar: m.avatarId, city: m.city };
      Object.assign(m, { interestTagIds: [], favoriteCount: 0, avatarId: "avatar-default", city: "", revision: m.revision + 1 });
      log(state, session, { action: "member.resetProfile", targetType: "member", targetId: m.id, targetLabel: m.displayName, summary: "Cleared interests, avatar, city and favorites; kept identity, role and points", reason, before, after: { interests: "0", favorites: "0", avatar: "avatar-default", city: "" } });
      save(state);
      return strip(m);
    },
    async adjustPoints(id, requestId, change, reason) {
      const state = load();
      const session = staff("points.adjust");
      if (!reason.trim()) throw new ApiError("invalid-argument", "Give a reason.", { reason: "Give a reason." });
      const m = member(state, session, id);
      const receiptKey = `${session.companyId}:${session.uid}:${requestId}`;
      if (state.receipts[receiptKey]) return strip(m);
      const next = "reset" in change ? 0 : m.pointsBalance + change.delta;
      if (!Number.isInteger(next) || next < 0) throw new ApiError("invalid-argument", "Points can’t go below zero.", { delta: "Points can’t go below zero." });
      const before = m.pointsBalance;
      m.pointsBalance = next;
      m.revision += 1;
      state.receipts[receiptKey] = m.id;
      log(state, session, { action: "member.points", targetType: "member", targetId: m.id, targetLabel: m.displayName, summary: "reset" in change ? "Reset points to 0" : `Adjusted points by ${change.delta > 0 ? "+" : ""}${change.delta}`, reason, before: { points: String(before) }, after: { points: String(next) } });
      save(state);
      return strip(m);
    },

    // ----- roster
    async listRoster() {
      const state = load();
      const session = staff("roster.manage");
      return state.roster.filter((r) => r.companyId === session.companyId)
        .map(({ companyId: _c, managerEmail: _m, startDate: _s, ...row }) => (void _c, void _m, void _s, row))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
    async resendInvite(email) {
      const state = load();
      const session = staff("roster.manage");
      const entry = state.roster.find((r) => r.companyId === session.companyId && r.email === email);
      if (!entry) throw new ApiError("not-found", "That person isn’t on the roster.", {}, "ROSTER_NOT_FOUND");
      if (entry.state !== "invited") throw new ApiError("failed-precondition", "Only people who haven’t signed up can be re-invited.", {}, "NOT_INVITED");
      if (entry.inviteCount >= 5) throw new ApiError("failed-precondition", "This invite was resent too many times. Try again tomorrow.", {}, "RATE_LIMITED");
      entry.lastInvitedAt = now().toISOString();
      entry.inviteCount += 1;
      log(state, session, { action: "roster.resend", targetType: "roster", targetId: email, targetLabel: entry.displayName, summary: `Invite ${entry.inviteCount} sent` });
      save(state);
      const { companyId: _c, managerEmail: _m, startDate: _s, ...row } = entry;
      void _c; void _m; void _s;
      return row;
    },
    async revokeInvite(email) {
      const state = load();
      const session = staff("roster.manage");
      const entry = state.roster.find((r) => r.companyId === session.companyId && r.email === email);
      if (!entry) throw new ApiError("not-found", "That person isn’t on the roster.", {}, "ROSTER_NOT_FOUND");
      if (entry.state !== "invited") throw new ApiError("failed-precondition", "Only pending invites can be revoked. Deactivate the member instead.", {}, "NOT_INVITED");
      entry.state = "revoked";
      log(state, session, { action: "roster.revoke", targetType: "roster", targetId: email, targetLabel: entry.displayName, summary: "Withdrew the invite" });
      save(state);
      const { companyId: _c, managerEmail: _m, startDate: _s, ...row } = entry;
      void _c; void _m; void _s;
      return row;
    },

    // ----- import
    async planImportChunk(request) {
      const state = load();
      const session = staff("import.run");
      if (request.rows.length === 0 || request.rows.length > IMPORT_LIMITS.chunkSize || request.rows.length !== request.lines.length) {
        throw new ApiError("invalid-argument", `Send 1 to ${IMPORT_LIMITS.chunkSize} rows per chunk.`, {}, "VALIDATION_FAILED");
      }
      const job = (state.jobs[request.jobId] ??= { companyId: session.companyId, plans: {}, applied: {} });
      if (job.companyId !== session.companyId) throw new ApiError("permission-denied", "That import belongs to another company.", {}, "COMPANY_MISMATCH");
      job.plans[request.chunkIndex] = { rows: request.rows, lines: request.lines };
      const seen = new Set<string>();
      const plans = request.rows.map((row, i) => {
        const plan = planRow(state, session, row, request.lines[i]);
        if (seen.has(row.email)) return { ...plan, action: "invalid" as const, errors: [...plan.errors, "Duplicate email in this chunk."] };
        seen.add(row.email);
        return plan;
      });
      save(state);
      return plans;
    },
    async applyImportChunk(jobId, chunkIndex) {
      const state = load();
      const session = staff("import.run");
      const job = state.jobs[jobId];
      if (!job || job.companyId !== session.companyId || !job.plans[chunkIndex]) throw new ApiError("not-found", "Run the preview again before applying.", {}, "IMPORT_NOT_FOUND");
      if (job.applied[chunkIndex]) return job.applied[chunkIndex];
      const { rows, lines } = job.plans[chunkIndex];
      // Plan again against current data so a row changed since the preview is never applied blindly.
      const results = rows.map((row, i) => applyPlanned(state, session, row, planRow(state, session, row, lines[i])));
      job.applied[chunkIndex] = results;
      const count = (outcome: string) => results.filter((r) => r.outcome === outcome).length;
      log(state, session, { action: "import.apply", targetType: "import", targetId: jobId, targetLabel: `Import ${jobId.slice(0, 8)}`, summary: `Chunk ${chunkIndex + 1}: ${count("created")} added, ${count("updated")} updated, ${count("unchanged")} unchanged, ${count("failed")} failed` });
      save(state);
      return results;
    },

    // ----- audit
    async listAudit() {
      const state = load();
      const session = staff("audit.view");
      return state.audit.filter((a) => a.companyId === session.companyId).map((a) => strip(a)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    },
  };
}
