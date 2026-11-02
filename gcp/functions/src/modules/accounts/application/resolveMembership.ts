import type { ResolveMembershipResponse } from "../../../generated/models";
import { AccountsError } from "../domain/errors";
import { assertEligible, decideMembership, type AuthIdentity } from "../domain/membership";
import { parseResolveMembershipRequest } from "../domain/resolveMembershipRequest";
import type { MembershipRateLimiter, MembershipStore } from "./ports";

/**
 * resolveMembershipV1 application service (ADR 0007, docs/contracts/callables.md).
 *
 * Order matters: authentication, payload validation, provider/verification and
 * personal-domain checks run before the rate limit and before any data is read.
 * An unmapped domain and a mapping to a missing company return the same
 * NO_COMPANY_FOR_DOMAIN error.
 */
export async function resolveMembership(
  store: MembershipStore,
  identity: AuthIdentity | null,
  data: unknown,
  limiter?: MembershipRateLimiter,
): Promise<ResolveMembershipResponse> {
  if (!identity) {
    throw new AccountsError("unauthenticated", "UNAUTHENTICATED", "Sign in to continue.");
  }
  parseResolveMembershipRequest(data);
  const eligible = assertEligible(identity);
  await limiter?.consume(eligible.uid);

  return store.runTransaction(async (tx) => {
    const companyId = await tx.companyIdForDomain(eligible.rootDomain);
    if (!companyId || !(await tx.companyExists(companyId))) {
      throw new AccountsError("not-found", "NO_COMPANY_FOR_DOMAIN", "Your company isn't on DIP yet.");
    }
    const existing = await tx.getMembership(eligible.uid);
    const decision = decideMembership(eligible, companyId, existing);
    if (decision.kind === "create") {
      tx.createMember(eligible.uid, decision.profile);
      return { contractVersion: 1, companyId, role: "member" };
    }
    if (decision.refreshDisplayName) tx.updateDisplayName(eligible.uid, decision.refreshDisplayName);
    return { contractVersion: 1, companyId: decision.companyId, role: decision.role };
  });
}
