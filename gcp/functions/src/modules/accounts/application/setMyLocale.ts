import type { SetMyLocaleResponse } from "../../../generated/models";
import { isLocale, type Locale } from "../../i18n";
import { AccountsError } from "../domain/errors";
import { isRole } from "../../admin/domain/permissions";

/**
 * setMyLocaleV1 (issue #259 backend phase, docs/design/backend-i18n.md): the signed-in member sets the language of
 * their emails and pushes, stored as the server-owned `users/{uid}.locale`. The uid comes from Auth only; clients cannot
 * write `locale` directly (Firestore rules keep the profile allow-list), so the value is always a supported locale.
 */

export interface LocaleCaller { uid: string; emailVerified: boolean; signInProvider: string | null }

export interface LocaleMember { companyId: unknown; role: unknown; status?: unknown; locale?: unknown }

export interface LocaleTransaction {
  getMember(uid: string): Promise<LocaleMember | null>;
  /** Merges `{ locale }` into `users/{uid}`; touches no other field. */
  setLocale(uid: string, locale: Locale): void;
}

export interface LocaleStore {
  runTransaction<T>(work: (tx: LocaleTransaction) => Promise<T>): Promise<T>;
}

/** Exactly `{ contractVersion: 1, locale: "en" | "es" }`; anything else (a uid, companyId, "fr") is VALIDATION_FAILED. */
export function parseSetMyLocaleRequest(data: unknown): Locale {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new AccountsError("invalid-argument", "VALIDATION_FAILED", "Invalid request.");
  }
  const record = data as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => key !== "contractVersion" && key !== "locale").sort();
  if (unknownKeys.length > 0) throw new AccountsError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", unknownKeys);
  if (record.contractVersion !== 1) throw new AccountsError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", ["contractVersion"]);
  if (!isLocale(record.locale)) throw new AccountsError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", ["locale"]);
  return record.locale;
}

/** Idempotent: the same locale again is a no-op (`changed: false`, no write). */
export async function setMyLocale(store: LocaleStore, caller: LocaleCaller | null, data: unknown): Promise<SetMyLocaleResponse> {
  if (!caller) throw new AccountsError("unauthenticated", "UNAUTHENTICATED", "Sign in again.");
  if (!caller.emailVerified) throw new AccountsError("permission-denied", "EMAIL_NOT_VERIFIED", "Verified email required.");
  if (caller.signInProvider !== "google.com") throw new AccountsError("permission-denied", "PROVIDER_NOT_ALLOWED", "Google sign-in required.");
  const locale = parseSetMyLocaleRequest(data);
  return store.runTransaction(async (tx) => {
    const member = await tx.getMember(caller.uid);
    if (!member || typeof member.companyId !== "string" || member.companyId === "" || !isRole(member.role)) {
      throw new AccountsError("permission-denied", "MEMBERSHIP_CONFLICT", "Company membership required.");
    }
    if (member.status === "deactivated") throw new AccountsError("permission-denied", "ACCOUNT_DEACTIVATED", "This account is deactivated.");
    if (member.locale === locale) return { contractVersion: 1, locale, changed: false };
    tx.setLocale(caller.uid, locale);
    return { contractVersion: 1, locale, changed: true };
  });
}
