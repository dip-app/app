import type { JoinCompanyResponse } from "../../../generated/models";
import { AccountsError } from "../domain/errors";
import { joinCodeLookupId } from "../domain/joinCode";
import { parseJoinCompanyRequest } from "../domain/joinCompanyRequest";
import { assertCanRequestMembership, decideMembership, type AuthIdentity } from "../domain/membership";
import type { MembershipStore } from "./ports";

/**
 * joinCompanyV1 application service (docs/contracts/callables.md).
 *
 * Order matters: authentication, payload validation and the verified-email gate
 * all run before any code lookup, so unverified or malformed callers cannot use
 * the endpoint to probe codes. An unknown code and a code pointing at a missing
 * company return the same generic not-found error.
 *
 * Not yet implemented: wrong-code rate limiting (required before rollout).
 */
export async function joinCompany(
  store: MembershipStore,
  identity: AuthIdentity | null,
  data: unknown,
): Promise<JoinCompanyResponse> {
  if (!identity) {
    throw new AccountsError("unauthenticated", "UNAUTHENTICATED", "Sign in to join a company.");
  }
  const request = parseJoinCompanyRequest(data);
  assertCanRequestMembership(identity);
  const lookupId = joinCodeLookupId(request.normalizedJoinCode);

  return store.runTransaction(async (tx) => {
    const companyId = await tx.resolveCompanyId(lookupId);
    if (!companyId || !(await tx.companyExists(companyId))) {
      throw new AccountsError("not-found", "INVALID_JOIN_CODE", "That join code is not valid.");
    }
    const existing = await tx.getMembership(identity.uid);
    const decision = decideMembership(identity, request.displayName, companyId, existing);
    if (decision.kind === "create") {
      tx.createMember(identity.uid, decision.profile);
      return { contractVersion: 1, companyId, role: "member" };
    }
    return { contractVersion: 1, companyId: decision.companyId, role: decision.role };
  });
}
