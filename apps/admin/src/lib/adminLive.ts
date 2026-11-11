import type { FirebaseApp } from "firebase/app";
import { type DocumentData, Timestamp, collection, doc, getDoc, getDocs, limit, orderBy, query, where, type Firestore } from "firebase/firestore";
import { type Functions, httpsCallable } from "firebase/functions";
import { getBlob, getStorage, ref } from "firebase/storage";
import type { AdminOpsApi } from "./adminApi";
import {
  ADMIN_CALLABLES, type AlbumComment, type AlbumPhoto, type ApplyRowResult, type Attendee, type AuditEntry, type CompanyInfo,
  type Member, type PlanRow, type RosterRow, type Role,
} from "./adminTypes";
import type { Session } from "./api";
import { ApiError } from "./contract";

// Live adapter for the admin tools. Lists are Firestore reads; every change goes through a callable. Paths
// and callable names follow docs/contracts/admin.md (ADMIN_CALLABLES holds the names). The backend enforces
// role, tenant and idempotency; this file only shapes requests and responses.

const iso = (value: unknown): string =>
  value instanceof Timestamp ? value.toDate().toISOString()
    : typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : "";
const str = (value: unknown) => (typeof value === "string" ? value : "");
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const roleOf = (value: unknown): Role => (value === "admin" || value === "organizer" ? value : "member");

export function memberFromDoc(id: string, d: DocumentData): Member {
  return {
    id, email: str(d.email), displayName: str(d.displayName), role: roleOf(d.role), teamIds: strings(d.teamIds), workLocation: str(d.workLocation),
    department: str(d.department), jobTitle: str(d.jobTitle), status: d.status === "deactivated" ? "deactivated" : d.status === "invited" ? "invited" : "active",
    pointsBalance: Number(d.pointsBalance ?? 0), createdAt: iso(d.createdAt), interestTagIds: strings(d.interestTagIds), avatarId: str(d.avatarId),
    city: str(d.city), favoriteCount: strings(d.favoritePhotoIds).length, revision: Number(d.revision ?? 1),
  };
}

export function rosterFromDoc(id: string, d: DocumentData): RosterRow {
  const state = d.status === "claimed" ? (d.memberStatus === "deactivated" ? "deactivated" : "active") : d.status === "revoked" ? "revoked" : "invited";
  return {
    email: str(d.email) || id, displayName: str(d.displayName), role: roleOf(d.role), teamIds: strings(d.teamIds), workLocation: str(d.workLocation),
    department: str(d.department), jobTitle: str(d.jobTitle), state, memberId: str(d.claimedBy) || undefined, invitedAt: iso(d.createdAt),
    lastInvitedAt: iso(d.lastInvitedAt ?? d.createdAt), inviteCount: Number(d.inviteCount ?? 1),
  };
}

export function auditFromDoc(id: string, d: DocumentData): AuditEntry {
  const map = (value: unknown): Record<string, string> | undefined =>
    value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : undefined;
  return {
    id, at: iso(d.at ?? d.createdAt), actorId: str(d.actorId), actorName: str(d.actorName), action: str(d.action),
    targetType: (str(d.targetType) || "member") as AuditEntry["targetType"], targetId: str(d.targetId), targetLabel: str(d.targetLabel),
    summary: str(d.summary), reason: str(d.reason) || undefined, before: map(d.before), after: map(d.after),
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
  async function call<T = Record<string, unknown>>(name: string, session: Session, payload: Record<string, unknown>): Promise<T> {
    const result = await httpsCallable<unknown, T>(functions, name)({ contractVersion: 1, companyId: session.companyId, ...payload });
    return result.data;
  }
  const col = (session: Session, ...path: string[]) => collection(db, "companies", session.companyId, ...path);
  const memberOf = (callResult: { member?: DocumentData; memberId?: string }, fallback: string, session: Session) =>
    callResult.member
      ? Promise.resolve(memberFromDoc(callResult.memberId ?? fallback, callResult.member))
      : getDoc(doc(db, "companies", session.companyId, "members", fallback)).then((snap) => memberFromDoc(snap.id, snap.data() ?? {}));

  return {
    companyInfo: () => run(async () => {
      const session = await organizer();
      const [company, teams] = await Promise.all([getDoc(doc(db, "companies", session.companyId)), getDocs(col(session, "teams"))]);
      const info: CompanyInfo = {
        id: session.companyId, name: str(company.get("name")), emailDomain: str(company.get("emailDomain")).toLowerCase(),
        teams: teams.docs.map((t) => ({ id: t.id, name: str(t.get("name")) || t.id })).sort((a, b) => a.name.localeCompare(b.name)),
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
      const snap = await getDocs(query(col(session, "events", eventId, "rsvps"), where("status", "==", "going"), limit(500)));
      return snap.docs.map((d): Attendee => ({
        memberId: str(d.get("userId")) || d.id, name: str(d.get("userName")), email: str(d.get("userEmail")), department: str(d.get("userDepartment")),
        jobTitle: str(d.get("userJobTitle")), rsvpAt: iso(d.get("createdAt")),
        attendance: d.get("checkedIn") === true ? "checkedIn" : d.get("attendance") === "noShow" ? "noShow" : "unmarked", addedByAdmin: d.get("addedBy") != null,
      })).sort((a, b) => a.name.localeCompare(b.name));
    }),
    addAttendee: (input) => run(async () => {
      const data = await call<{ attendeeCount: number }>(ADMIN_CALLABLES.addAttendee, await organizer(), {
        eventId: input.eventId, userId: input.memberId, requestId: input.requestId, overrideCapacity: input.overrideCapacity, reason: input.reason, notify: input.notify,
      });
      return { attendeeCount: Number(data.attendeeCount ?? 0) };
    }),
    removeAttendee: (eventId, memberId, notify, reason) => run(async () => {
      const data = await call<{ attendeeCount: number }>(ADMIN_CALLABLES.removeAttendee, await organizer(), { eventId, userId: memberId, notify, reason });
      return { attendeeCount: Number(data.attendeeCount ?? 0) };
    }),
    setAttendance: (eventId, memberId, attendance) => run(async () => {
      const session = await organizer();
      // recordAttendanceV1 (existing contract) checks a member in and awards points; other states use the admin callable.
      const data = attendance === "checkedIn"
        ? await call<{ pointsAwarded: number }>(ADMIN_CALLABLES.recordAttendance, session, { eventId, userId: memberId })
        : await call<{ pointsAwarded: number }>(ADMIN_CALLABLES.setAttendance, session, { eventId, userId: memberId, attendance });
      return { pointsAwarded: Number(data.pointsAwarded ?? 0) };
    }),

    listMembers: () => run(async () => {
      const session = await organizer();
      const snap = await getDocs(query(col(session, "members"), orderBy("displayName"), limit(1000)));
      return snap.docs.map((d) => memberFromDoc(d.id, d.data()));
    }),
    getMember: (id) => run(async () => {
      const session = await organizer();
      const snap = await getDoc(doc(db, "companies", session.companyId, "members", id));
      if (!snap.exists()) throw new ApiError("not-found", "That member doesn’t exist.", {}, "MEMBER_NOT_FOUND");
      return memberFromDoc(snap.id, snap.data());
    }),
    updateMember: (id, expectedRevision, patch) => run(async () => {
      const session = await organizer();
      return memberOf(await call(ADMIN_CALLABLES.updateMember, session, { memberId: id, expectedRevision, patch }), id, session);
    }),
    setMemberStatus: (id, status, reason) => run(async () => {
      const session = await organizer();
      return memberOf(await call(ADMIN_CALLABLES.setMemberStatus, session, { memberId: id, status, reason }), id, session);
    }),
    resetMemberProfile: (id, reason) => run(async () => {
      const session = await organizer();
      return memberOf(await call(ADMIN_CALLABLES.resetMemberProfile, session, { memberId: id, reason }), id, session);
    }),
    adjustPoints: (id, requestId, change, reason) => run(async () => {
      const session = await organizer();
      return memberOf(await call(ADMIN_CALLABLES.adjustPoints, session, { memberId: id, requestId, reason, ...("reset" in change ? { reset: true } : { delta: change.delta }) }), id, session);
    }),

    listRoster: () => run(async () => {
      const session = await organizer();
      const snap = await getDocs(query(col(session, "roster"), limit(2000)));
      return snap.docs.map((d) => rosterFromDoc(d.id, d.data())).sort((a, b) => a.displayName.localeCompare(b.displayName));
    }),
    resendInvite: (email) => run(async () => {
      const session = await organizer();
      await call(ADMIN_CALLABLES.resendInvite, session, { email });
      const snap = await getDoc(doc(db, "companies", session.companyId, "roster", email));
      return rosterFromDoc(snap.id, snap.data() ?? {});
    }),
    revokeInvite: (email) => run(async () => {
      const session = await organizer();
      await call(ADMIN_CALLABLES.revokeInvite, session, { email });
      const snap = await getDoc(doc(db, "companies", session.companyId, "roster", email));
      return rosterFromDoc(snap.id, snap.data() ?? {});
    }),
    planImportChunk: (request) => run(async () => {
      const data = await call<{ rows: PlanRow[] }>(ADMIN_CALLABLES.planImport, await organizer(), { ...request });
      return data.rows;
    }),
    applyImportChunk: (jobId, chunkIndex) => run(async () => {
      const data = await call<{ rows: ApplyRowResult[] }>(ADMIN_CALLABLES.applyImport, await organizer(), { jobId, chunkIndex });
      return data.rows;
    }),

    listAudit: () => run(async () => {
      const session = await organizer();
      const snap = await getDocs(query(col(session, "auditLog"), orderBy("at", "desc"), limit(300)));
      return snap.docs.map((d) => auditFromDoc(d.id, d.data()));
    }),
  };
}
