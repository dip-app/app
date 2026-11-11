import type { Coworker, ListCoworkersResponse } from "../../../generated/models";
import { InviteError } from "../domain/errors";
import { DIRECTORY_SCAN_CAP, SEARCH_LIMIT, SEARCH_WINDOW_MS, fold, nameMatches, parseSearch } from "../domain/invitePolicy";
import type { InviteCaller, InviteStore } from "./ports";
import { requireCaller } from "./sendInvite";

/**
 * listCoworkersV1: the invite picker's directory. It is the only read of other members' profiles and it
 * returns the minimal projection (display name, avatar id, team) for same-company members whose name matches a
 * query of at least two characters; the caller is excluded and a rate budget limits harvesting. No email, role,
 * points, interests or any other profile field leaves the server (data-ownership.md).
 */
export async function listCoworkers(store: InviteStore, callerIn: InviteCaller | null, data: unknown,
  now: () => Date = () => new Date()): Promise<ListCoworkersResponse> {
  const caller = requireCaller(callerIn);
  const { companyId, eventId, query, limit } = parseSearch(data);
  const uid = caller.uid;
  const member = await store.getMember(uid);
  if (!member || member.companyId !== companyId || (member.role !== "member" && member.role !== "admin")) {
    throw new InviteError("permission-denied", "MEMBERSHIP_CONFLICT", "Company membership required.");
  }
  const event = await store.getEvent(companyId, eventId);
  if (!event || event.companyId !== companyId) throw new InviteError("not-found", "EVENT_NOT_FOUND", "Event not found.");
  if (!(await store.consumeBudget(`search_${uid}`, SEARCH_LIMIT, SEARCH_WINDOW_MS, now().getTime()))) {
    throw new InviteError("resource-exhausted", "RATE_LIMITED", "Too many searches. Try again in a moment.");
  }
  const { members, complete } = await store.listMembers(companyId, DIRECTORY_SCAN_CAP);
  const needle = fold(query);
  const matches = members
    .filter((candidate) => candidate.userId !== uid && candidate.displayName !== "" && nameMatches(candidate.displayName, query))
    .sort((a, b) => {
      const rank = (name: string) => (fold(name).startsWith(needle) ? 0 : 1);
      return rank(a.displayName) - rank(b.displayName) || fold(a.displayName).localeCompare(fold(b.displayName)) || a.userId.localeCompare(b.userId);
    });
  const page = matches.slice(0, limit);
  const states = await store.memberStates(companyId, eventId, page.map((candidate) => candidate.userId));
  const coworkers: Coworker[] = page.map((candidate) => ({
    userId: candidate.userId, displayName: candidate.displayName, avatarId: candidate.avatarId,
    department: candidate.department, state: states.get(candidate.userId) ?? "available",
  }));
  return { contractVersion: 1, coworkers, truncated: matches.length > limit || !complete };
}
