import { AccountsError } from "./errors";

export type MembershipRole = "member" | "admin";

/** Trusted caller identity, derived only from the verified Firebase Auth token. */
export interface AuthIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

/** The server-owned membership fields already stored on users/{uid}. */
export interface StoredMembership {
  companyId: string;
  role: string;
}

/** Profile written for a first-time member. createdAt is assigned by the store (server time). */
export interface NewMemberProfile {
  companyId: string;
  displayName: string;
  email: string;
  photoURL: string;
  avatarId: string;
  department: string;
  jobTitle: string;
  city: string;
  role: "member";
  interestTagIds: string[];
  travelRadiusMiles: number;
  availability: string[];
  friendIds: string[];
  favoritePhotoIds: string[];
  pointsBalance: number;
}

/** Documented default travel radius for new profiles (miles). */
export const DEFAULT_TRAVEL_RADIUS_MILES = 20;

export type MembershipDecision =
  | { kind: "create"; profile: NewMemberProfile }
  | { kind: "existing"; companyId: string; role: MembershipRole };

/** Membership requires a verified email; unverified domains never auto-join. */
export function assertCanRequestMembership(identity: AuthIdentity): asserts identity is AuthIdentity & { email: string } {
  if (!identity.emailVerified || !identity.email) {
    throw new AccountsError("permission-denied", "EMAIL_NOT_VERIFIED", "Verify your email before joining a company.");
  }
}

function isRole(value: string): value is MembershipRole {
  return value === "member" || value === "admin";
}

/**
 * Pure decision for a join attempt once the code has resolved to `targetCompanyId`.
 * - No membership: create a member profile with documented defaults (never admin, zero balance).
 * - Same company: replay the stored membership unchanged (an admin stays admin; nothing is promoted).
 * - Different company: refuse; switching tenants is not a V1 operation.
 */
export function decideMembership(
  identity: AuthIdentity & { email: string },
  displayName: string,
  targetCompanyId: string,
  existing: StoredMembership | null,
): MembershipDecision {
  if (existing) {
    if (existing.companyId !== targetCompanyId) {
      throw new AccountsError(
        "failed-precondition",
        "MEMBERSHIP_CONFLICT",
        "This account already belongs to a different company.",
      );
    }
    if (!isRole(existing.role)) {
      throw new AccountsError("internal", "INVALID_STORED_MEMBERSHIP", "Stored membership has an unknown role.");
    }
    return { kind: "existing", companyId: existing.companyId, role: existing.role };
  }
  return {
    kind: "create",
    profile: {
      companyId: targetCompanyId,
      displayName,
      email: identity.email,
      photoURL: "",
      avatarId: "",
      department: "",
      jobTitle: "",
      city: "",
      role: "member",
      interestTagIds: [],
      travelRadiusMiles: DEFAULT_TRAVEL_RADIUS_MILES,
      availability: [],
      friendIds: [],
      favoritePhotoIds: [],
      pointsBalance: 0,
    },
  };
}
