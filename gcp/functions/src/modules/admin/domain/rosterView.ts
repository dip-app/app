import type { RosterEntry } from "../../../generated/models";
import { isRole } from "./permissions";

type Doc = Record<string, unknown>;

export type RosterState = "invited" | "active" | "deactivated" | "revoked";

const text = (value: unknown) => (typeof value === "string" ? value : "");
const toIso = (value: unknown) => (value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : "");

/** What the roster shows for an entry: invited / revoked as stored, claimed entries by their member's status. */
export function rosterStateOf(entry: Doc): RosterState {
  if (entry.status === "revoked") return "revoked";
  if (entry.status === "claimed") return entry.memberStatus === "deactivated" ? "deactivated" : "active";
  return "invited";
}

/** Wire projection of `companies/{c}/roster/{emailHash}` (dates as RFC 3339 strings). */
export function toRosterEntry(id: string, entry: Doc): RosterEntry {
  const out: RosterEntry = {
    id, companyId: text(entry.companyId), email: text(entry.email), displayName: text(entry.displayName), role: isRole(entry.role) ? entry.role : "member",
    teamIds: Array.isArray(entry.teamIds) ? entry.teamIds.filter((t): t is string => typeof t === "string") : [],
    workLocation: text(entry.workLocation), department: text(entry.department), jobTitle: text(entry.jobTitle),
    status: entry.status === "claimed" ? "claimed" : entry.status === "revoked" ? "revoked" : "invited",
    source: entry.source === "import" ? "import" : entry.source === "signup" ? "signup" : "manual",
    createdAt: toIso(entry.createdAt), updatedAt: toIso(entry.updatedAt), revision: typeof entry.revision === "number" && entry.revision >= 1 ? entry.revision : 1,
  };
  if (text(entry.managerEmail)) out.managerEmail = text(entry.managerEmail);
  if (text(entry.startDate)) out.startDate = text(entry.startDate);
  if (typeof entry.importJobId === "string") out.importJobId = entry.importJobId;
  if (typeof entry.claimedBy === "string") out.claimedBy = entry.claimedBy;
  if (toIso(entry.claimedAt)) out.claimedAt = toIso(entry.claimedAt);
  if (typeof entry.invitedBy === "string") out.invitedBy = entry.invitedBy;
  if (entry.memberStatus === "active" || entry.memberStatus === "deactivated") out.memberStatus = entry.memberStatus;
  if (typeof entry.resendCount === "number") out.resendCount = entry.resendCount;
  if (toIso(entry.lastResentAt)) out.lastResentAt = toIso(entry.lastResentAt);
  if (typeof entry.lastResentBy === "string") out.lastResentBy = entry.lastResentBy;
  return out;
}

export interface RosterFilter { state?: RosterState | undefined; query?: string | undefined }

export function matchesRoster(entry: RosterEntry, filter: RosterFilter): boolean {
  if (filter.state && rosterStateOf({ status: entry.status, memberStatus: entry.memberStatus }) !== filter.state) return false;
  const query = filter.query?.trim().toLowerCase();
  if (query) {
    const haystack = [entry.displayName, entry.email, entry.department, entry.jobTitle, entry.workLocation].join("\n").toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

export const MAX_RESENDS = 10;
export const SIGN_IN_URL_MEMBER = "https://letsdip.work";
export const SIGN_IN_URL_ADMIN = "https://letsdip.work/admin/";

/**
 * The text an admin copies to nudge an invited person. DIP sends no email, so a resend records the event and hands back a
 * link and message to share through the admin's own channel (email, chat).
 */
export function inviteMessage(input: { name: string; company: string; email: string; role: string }): { signInUrl: string; message: string } {
  const staff = input.role === "admin" || input.role === "organizer";
  const signInUrl = staff ? SIGN_IN_URL_ADMIN : SIGN_IN_URL_MEMBER;
  const first = input.name.trim().split(/\s+/)[0] ?? "";
  const where = staff ? `the DIP admin portal (${signInUrl})` : `the DIP app (${signInUrl})`;
  const message = [
    `${first ? `Hi ${first}, y` : "Y"}ou're set up on DIP at ${input.company || "your company"}.`,
    `Open ${where} and sign in with Google using ${input.email}.`,
    staff ? "Your role is already assigned." : "Your teams and details are already filled in.",
  ].join(" ");
  return { signInUrl, message: message.slice(0, 1000) };
}
