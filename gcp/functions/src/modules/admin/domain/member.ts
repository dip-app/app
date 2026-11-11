import { isRole, type Role } from "./permissions";

type Doc = Record<string, unknown>;

export type MemberStatus = "invited" | "active" | "deactivated";
export const DEFAULT_TRAVEL_RADIUS_MILES = 20;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const toIso = (value: unknown) => (value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : "");

/** Missing status means active (members created before the status field existed). */
export function statusOf(member: Doc): MemberStatus {
  return member.status === "deactivated" ? "deactivated" : member.status === "invited" ? "invited" : "active";
}

export const isDeactivated = (member: Doc) => member.status === "deactivated";
export const revisionOf = (member: Doc) => (typeof member.revision === "number" && Number.isSafeInteger(member.revision) ? member.revision : 0);

export interface MemberSummary {
  userId: string; email: string; displayName: string; avatarId: string; photoURL: string; role: Role; status: MemberStatus;
  department: string; jobTitle: string; city: string; workLocation: string; teamIds: string[];
  managerEmail?: string; startDate?: string; pointsBalance?: number; revision: number; createdAt: string;
}

/** Admin directory projection of users/{uid}. Points are admin-only; interests, friends and favorites are never exposed. */
export function toSummary(userId: string, member: Doc, includePoints: boolean): MemberSummary {
  const summary: MemberSummary = {
    userId, email: text(member.email), displayName: text(member.displayName), avatarId: text(member.avatarId), photoURL: text(member.photoURL),
    role: isRole(member.role) ? member.role : "member", status: statusOf(member),
    department: text(member.department), jobTitle: text(member.jobTitle), city: text(member.city), workLocation: text(member.workLocation),
    teamIds: strings(member.teamIds), revision: revisionOf(member), createdAt: toIso(member.createdAt),
  };
  if (typeof member.managerEmail === "string") summary.managerEmail = member.managerEmail;
  if (typeof member.startDate === "string") summary.startDate = member.startDate;
  if (includePoints && typeof member.pointsBalance === "number") summary.pointsBalance = member.pointsBalance;
  return summary;
}

export interface MemberFilter { query?: string | undefined; role?: Role | undefined; status?: MemberStatus | undefined; teamId?: string | undefined; workLocation?: string | undefined }

export function matchesFilter(summary: MemberSummary, filter: MemberFilter): boolean {
  if (filter.role && summary.role !== filter.role) return false;
  if (filter.status && summary.status !== filter.status) return false;
  if (filter.teamId && !summary.teamIds.includes(filter.teamId)) return false;
  if (filter.workLocation && summary.workLocation.toLowerCase() !== filter.workLocation.toLowerCase()) return false;
  const query = filter.query?.trim().toLowerCase();
  if (query) {
    const haystack = [summary.displayName, summary.email, summary.department, summary.jobTitle, summary.workLocation].join("\n").toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

/** Self-set profile fields cleared by resetMemberProfileV1 (identity, role, org attributes, friends and points stay). */
export const RESET_VALUES: Readonly<Record<string, unknown>> = {
  photoURL: "", avatarId: "", city: "", interestTagIds: [], travelRadiusMiles: DEFAULT_TRAVEL_RADIUS_MILES, availability: [], favoritePhotoIds: [],
};

/** Fields whose stored value differs from the reset default. */
export function resetPatch(member: Doc): Doc {
  const patch: Doc = {};
  for (const [key, value] of Object.entries(RESET_VALUES)) {
    if (JSON.stringify(member[key] ?? null) !== JSON.stringify(value)) patch[key] = value;
  }
  return patch;
}

/** True when another active admin (not `exceptUid`) remains in the company. */
export function hasOtherActiveAdmin(admins: ReadonlyArray<{ id: string; data: Doc }>, exceptUid: string): boolean {
  return admins.some(a => a.id !== exceptUid && a.data.role === "admin" && !isDeactivated(a.data));
}
