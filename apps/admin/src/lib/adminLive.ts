import type { FirebaseApp } from "firebase/app";
import {
  type DocumentData, type Firestore, type QueryDocumentSnapshot, Timestamp, collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, startAfter, where,
} from "firebase/firestore";
import { type Functions, httpsCallable } from "firebase/functions";
import { getBlob, getStorage, ref } from "firebase/storage";
import type { AdminOpsApi } from "./adminApi";
import {
  ADMIN_CALLABLES, type AlbumComment, type AlbumPhoto, type ApplyStepResponse, type Attendee, type AuditEntry, type CompanyInfo,
  type ImportPlanResponse, type ImportRow, type Member, type Role, type RosterRow,
} from "./adminTypes";
import type { Session } from "./api";

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
    avatarId: str(d.avatarId), city: str(d.city), revision: Number(d.revision ?? 0),
  };
}

/** A `roster/{emailHash}` document. Claimed entries are represented by their member instead. */
export function rosterFromDoc(id: string, d: DocumentData): RosterRow {
  return {
    entryId: id, email: str(d.email), displayName: str(d.displayName), role: roleOf(d.role), teamIds: strings(d.teamIds), workLocation: str(d.workLocation),
    department: str(d.department), jobTitle: str(d.jobTitle), managerEmail: str(d.managerEmail), startDate: str(d.startDate),
    state: d.status === "revoked" ? "revoked" : d.status === "claimed" ? "active" : "invited", invitedAt: iso(d.createdAt),
  };
}

export function auditFromDoc(id: string, d: DocumentData): AuditEntry {
  const changes = Array.isArray(d.changes) ? (d.changes as Record<string, unknown>[]).map((c) => ({ field: str(c.field), before: str(c.before), after: str(c.after) })) : [];
  return {
    id, at: iso(d.createdAt), actorId: str(d.actorId), actorName: str(d.actorName), actorRole: roleOf(d.actorRole), action: str(d.action),
    targetType: (str(d.targetType) || "member") as AuditEntry["targetType"], targetId: str(d.targetId), summary: str(d.summary),
    reason: str(d.reason) || undefined, changes,
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
  /** Calls a callable with the contract envelope; `mutating` adds a fresh requestId (retries of one UI action reuse the caller's own). */
  async function call<T = Record<string, unknown>>(name: string, session: Session, payload: Record<string, unknown>, mutating = true): Promise<T> {
    const result = await httpsCallable<unknown, T>(functions, name)({
      contractVersion: 1, companyId: session.companyId, ...(mutating ? { requestId: crypto.randomUUID() } : {}), ...payload,
    });
    return result.data;
  }
  const col = (session: Session, ...path: string[]) => collection(db, "companies", session.companyId, ...path);

  async function listMembersAll(session: Session): Promise<Member[]> {
    const members: Member[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 30; page += 1) {
      const data = await call<{ members: DocumentData[]; nextPageToken?: string }>(ADMIN_CALLABLES.listMembers, session, { pageSize: 100, ...(pageToken ? { pageToken } : {}) }, false);
      members.push(...data.members.map(memberFromSummary));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return members.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  async function member(session: Session, id: string): Promise<Member> {
    const data = await call<{ member: DocumentData }>(ADMIN_CALLABLES.getMember, session, { userId: id }, false);
    return memberFromSummary(data.member);
  }
  /** Roster rules cap lists at 100 documents, so read page by page. */
  async function rosterDocs(session: Session): Promise<QueryDocumentSnapshot[]> {
    const docs: QueryDocumentSnapshot[] = [];
    let last: QueryDocumentSnapshot | undefined;
    for (let page = 0; page < 30; page += 1) {
      const snap = await getDocs(query(col(session, "roster"), orderBy("createdAt"), ...(last ? [startAfter(last)] : []), limit(100)));
      docs.push(...snap.docs);
      last = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < 100) break;
    }
    return docs;
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
      const emails = new Map((await listMembersAll(session).catch(() => [] as Member[])).map((m) => [m.id, m.email]));
      return docs.map((d): Attendee => {
        const id = str(d.get("userId")) || d.id;
        return {
          memberId: id, name: str(d.get("userName")), email: emails.get(id) ?? "", department: str(d.get("userDepartment")),
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

    // Roster = pending and revoked entries (Firestore, admin-only rules) plus every member (listMembersV1) as active or deactivated.
    listRoster: () => run(async () => {
      const session = await organizer();
      const [docs, members] = await Promise.all([rosterDocs(session), listMembersAll(session)]);
      const memberEmails = new Set(members.map((m) => m.email.toLowerCase()));
      const entries = docs.map((d) => rosterFromDoc(d.id, d.data())).filter((r) => r.state !== "active" && !memberEmails.has(r.email.toLowerCase()));
      const people = members.map((m): RosterRow => ({
        entryId: m.id, email: m.email, displayName: m.displayName, role: m.role, teamIds: m.teamIds, workLocation: m.workLocation, department: m.department,
        jobTitle: m.jobTitle, managerEmail: "", startDate: "", state: m.status === "deactivated" ? "deactivated" : "active", memberId: m.id, invitedAt: m.createdAt,
      }));
      return [...entries, ...people].sort((a, b) => a.displayName.localeCompare(b.displayName));
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

    listAudit: () => run(async () => {
      const session = await organizer();
      const snap = await getDocs(query(col(session, "auditLog"), orderBy("createdAt", "desc"), limit(100)));
      return snap.docs.map((d) => auditFromDoc(d.id, d.data()));
    }),
  };
}
