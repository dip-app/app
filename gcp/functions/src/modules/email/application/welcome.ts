import { enqueueEmail, type EnqueueDeps, type EnqueueResult } from "./enqueueEmail";
import type { CompanySettingsReader } from "./ports";

/**
 * Welcome email (account category, docs/design/email-catalog.md): one per member, queued when `users/{uid}` is created
 * by the first membership resolve. The outbox id `account_<companyId>_<uid>_welcome` is deterministic, so a redelivered
 * trigger queues nothing new. Nothing is queued while email is off for the company (it is not caught up later: a
 * welcome weeks after joining would be noise).
 */

export interface WelcomeDeps extends EnqueueDeps {
  config: { enabled: boolean };
  companies: CompanySettingsReader;
  /** `companies/{c}.name`, or null when the company is missing. */
  companyName(companyId: string): Promise<string | null>;
}

export interface NewMember { uid: string; data: Readonly<Record<string, unknown>> }

export type WelcomeOutcome = EnqueueResult | { enqueued: false; reason: "disabled" | "company_disabled" | "not_member" | "no_company" };

/** A welcome sent more than two days after joining is stale. */
const WELCOME_TTL_MS = 2 * 86_400_000;

export async function onMemberCreatedForWelcome(deps: WelcomeDeps, member: NewMember): Promise<WelcomeOutcome> {
  if (!deps.config.enabled) return { enqueued: false, reason: "disabled" };
  const companyId = member.data.companyId;
  const role = member.data.role;
  if (typeof companyId !== "string" || companyId === "" || (role !== "member" && role !== "organizer" && role !== "admin")) {
    return { enqueued: false, reason: "not_member" };
  }
  if (member.data.status !== undefined && member.data.status !== "active") return { enqueued: false, reason: "not_member" };
  const settings = await deps.companies.get(companyId);
  if (settings?.enabled !== true) return { enqueued: false, reason: "company_disabled" };
  const companyName = (await deps.companyName(companyId))?.trim() ?? "";
  if (companyName === "") return { enqueued: false, reason: "no_company" };
  const now = deps.clock.now();
  return enqueueEmail(deps, {
    template: "welcome", variables: { companyName: companyName.slice(0, 120), role }, uid: member.uid, companyId,
    objectId: companyId, revisionOrWindow: "welcome", notAfter: new Date(now.getTime() + WELCOME_TTL_MS),
  });
}
