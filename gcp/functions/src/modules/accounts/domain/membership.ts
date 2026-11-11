import { AccountsError } from "./errors";
import { isPersonalEmailDomain, rootDomainOfEmail } from "./emailDomain";

export type MembershipRole = "member" | "organizer" | "admin";

/** V1 sign-in providers that may resolve a company (ADR 0007: Google only). */
export const ALLOWED_SIGN_IN_PROVIDERS: ReadonlySet<string> = new Set(["google.com"]);
export const MAX_DISPLAY_NAME_LENGTH = 80;

/** Trusted caller identity, derived only from the verified Firebase ID token. */
export interface AuthIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  /** `firebase.sign_in_provider` claim, e.g. "google.com" or "password". */
  signInProvider: string | null;
  /** OAuth profile name (`name` claim), if any. */
  name: string | null;
}

/** An identity that passed every pre-lookup check. */
export interface EligibleIdentity extends AuthIdentity {
  email: string;
  rootDomain: string;
  displayName: string;
}

/** The server-owned fields already stored on users/{uid}. */
export interface StoredMembership {
  companyId: string;
  role: string;
  displayName: string;
  /** "deactivated" blocks the account; missing means active. */
  status?: string;
}

/** Company onboarding policy (companies.membershipMode, missing = open). */
export type MembershipMode = "open" | "rosterOnly";

/** A pre-provisioned roster entry (companies/{c}/roster/{sha256(email)}), as read by the claim step. */
export interface RosterClaim {
  entryId: string;
  email: string;
  status: string;
  displayName: string;
  role: string;
  teamIds: string[];
  workLocation: string;
  department: string;
  jobTitle: string;
  managerEmail?: string;
  startDate?: string;
}

export interface Onboarding { mode: MembershipMode; entry: RosterClaim | null }

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
  role: MembershipRole;
  interestTagIds: string[];
  travelRadiusMiles: number;
  availability: string[];
  friendIds: string[];
  favoritePhotoIds: string[];
  pointsBalance: number;
  /** Set only when a roster entry is claimed; the default path leaves these absent. */
  workLocation?: string;
  teamIds?: string[];
  status?: "active";
  managerEmail?: string;
  startDate?: string;
}

/** Documented default travel radius for new profiles (miles). */
export const DEFAULT_TRAVEL_RADIUS_MILES = 20;

/**
 * Display name from OAuth (ADR 0007): the token's `name`, else the email's
 * local part; whitespace collapsed and trimmed, at most 80 characters.
 * It is server-written and not user-editable.
 */
export function displayNameFor(name: string | null, email: string): string {
  const pick = (value: string) => value.replace(/\s+/g, " ").trim();
  const fromName = name ? pick(name) : "";
  const fallback = pick(email.slice(0, Math.max(0, email.lastIndexOf("@")))) || "DIP member";
  const chosen = fromName || fallback;
  return Array.from(chosen).slice(0, MAX_DISPLAY_NAME_LENGTH).join("").trim();
}

/**
 * Every check that runs before any data is read: verified email, Google
 * provider, a usable root domain, and not a personal email provider.
 */
export function assertEligible(identity: AuthIdentity): EligibleIdentity {
  if (!identity.signInProvider || !ALLOWED_SIGN_IN_PROVIDERS.has(identity.signInProvider)) {
    throw new AccountsError("permission-denied", "PROVIDER_NOT_ALLOWED", "Sign in with Google to use DIP.");
  }
  if (!identity.emailVerified || !identity.email) {
    throw new AccountsError("permission-denied", "EMAIL_NOT_VERIFIED", "Your Google account email isn't verified.");
  }
  const rootDomain = rootDomainOfEmail(identity.email);
  if (!rootDomain) {
    throw new AccountsError("not-found", "NO_COMPANY_FOR_DOMAIN", "Your company isn't on DIP yet.");
  }
  if (isPersonalEmailDomain(rootDomain)) {
    throw new AccountsError("permission-denied", "PERSONAL_EMAIL_DOMAIN", "Sign in with your work Google account.");
  }
  return { ...identity, email: identity.email, rootDomain, displayName: displayNameFor(identity.name, identity.email) };
}

function isRole(value: string): value is MembershipRole {
  return value === "member" || value === "organizer" || value === "admin";
}

export type MembershipDecision =
  | { kind: "create"; profile: NewMemberProfile; claimedEntryId?: string }
  | { kind: "existing"; companyId: string; role: MembershipRole; refreshDisplayName: string | null };

/**
 * Pure decision once the root domain resolved to `targetCompanyId`.
 * - No membership: create a member profile with documented defaults (never admin, zero balance).
 * - Same company: return the stored membership; refresh the OAuth display name if it changed.
 * - Different company: refuse; switching tenants is not a V1 operation.
 */
export function decideMembership(
  identity: EligibleIdentity,
  targetCompanyId: string,
  existing: StoredMembership | null,
  onboarding: Onboarding = { mode: "open", entry: null },
): MembershipDecision {
  if (existing) {
    if (existing.status === "deactivated") {
      throw new AccountsError("permission-denied", "ACCOUNT_DEACTIVATED", "This account has been deactivated. Contact your organizer.");
    }
    if (existing.companyId !== targetCompanyId) {
      throw new AccountsError("failed-precondition", "MEMBERSHIP_CONFLICT", "This account already belongs to a different company.");
    }
    if (!isRole(existing.role)) {
      throw new AccountsError("internal", "INVALID_STORED_MEMBERSHIP", "Stored membership has an unknown role.");
    }
    const refreshDisplayName = existing.displayName === identity.displayName ? null : identity.displayName;
    return { kind: "existing", companyId: existing.companyId, role: existing.role, refreshDisplayName };
  }
  // First sign-in: claim an invited roster entry whose email equals the verified token email; otherwise follow the
  // company's mode (open = today's default member, rosterOnly = refused).
  const entry = onboarding.entry;
  const claimable = entry !== null && entry.status === "invited" && entry.email === identity.email.toLowerCase() && isRole(entry.role);
  if (!claimable && onboarding.mode === "rosterOnly") {
    throw new AccountsError("permission-denied", "NOT_ON_ROSTER", "Your organizer hasn't added you to DIP yet.");
  }
  if (claimable && entry) {
    // Google's name wins; the roster name is only a fallback when the token carries none.
    const hint = Array.from(entry.displayName.trim()).slice(0, MAX_DISPLAY_NAME_LENGTH).join("");
    return {
      kind: "create", claimedEntryId: entry.entryId,
      profile: {
        ...defaultProfile(identity, targetCompanyId),
        displayName: identity.name && identity.name.trim() ? identity.displayName : (hint || identity.displayName),
        role: entry.role as MembershipRole, department: entry.department, jobTitle: entry.jobTitle,
        workLocation: entry.workLocation, teamIds: entry.teamIds, status: "active",
        ...(entry.managerEmail !== undefined ? { managerEmail: entry.managerEmail } : {}),
        ...(entry.startDate !== undefined ? { startDate: entry.startDate } : {}),
      },
    };
  }
  return { kind: "create", profile: defaultProfile(identity, targetCompanyId) };
}

function defaultProfile(identity: EligibleIdentity, targetCompanyId: string): NewMemberProfile {
  return {
    companyId: targetCompanyId,
    displayName: identity.displayName,
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
  };
}
