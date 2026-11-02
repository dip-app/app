import { getDomain } from "tldts";
import personalDomainList from "./personal-email-domains.json";

/**
 * Consumer email providers that can never identify a company (ADR 0007).
 * Shared with gcp/scripts/seed.mjs, which refuses to map them.
 */
export const PERSONAL_EMAIL_DOMAINS: ReadonlySet<string> = new Set(personalDomainList);

/**
 * Registrable root domain of an email address, lowercased, using the Public
 * Suffix List (ICANN section only): `pat@eng.acme.com` -> `acme.com`,
 * `pat@team.acme.co.uk` -> `acme.co.uk`. Returns null when the address has no
 * usable domain (missing `@`, IP literal, bare hostname).
 */
export function rootDomainOfEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const host = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.startsWith("[")) return null;
  const root = getDomain(host, { allowPrivateDomains: false, detectIp: true, validateHostname: true });
  return root ? root.toLowerCase() : null;
}

export function isPersonalEmailDomain(rootDomain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(rootDomain.toLowerCase());
}
