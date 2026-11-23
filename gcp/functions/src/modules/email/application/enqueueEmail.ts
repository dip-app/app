import { resolvePreferences } from "../../notifications/domain/preferences";
import type { SubscriptionLevel } from "../../notifications/domain/subscription";
import { categoryOf, outboxId } from "../domain/outbox";
import { decideEmail, type EmailRoutingDecision } from "../domain/policy";
import { templateKind, type TemplateId, type TemplateVariables } from "../domain/templates/types";
import type { Clock, CompanySettingsReader, EmailPreferencesStore, OutboxStore } from "./ports";

export interface EnqueueDeps {
  outbox: OutboxStore;
  clock: Clock;
  validate(template: TemplateId, value: unknown): TemplateVariables[TemplateId] | null;
}

export interface EnqueueInput<T extends TemplateId = TemplateId> {
  template: T;
  variables: TemplateVariables[T];
  uid: string;
  companyId: string;
  /** Event or challenge id the email is about. */
  objectId: string;
  /** Change revision or reminder window; makes the outbox id deterministic. */
  revisionOrWindow: string;
  notAfter?: Date | null;
}

export interface EnqueueResult { enqueued: boolean; id: string; reason?: "invalid_variables" | "invalid_input" | "duplicate" }

/** Creates the outbox entry once; a replay of the same candidate is a no-op. Stores the validated, allow-listed variables. */
export async function enqueueEmail(deps: EnqueueDeps, input: EnqueueInput): Promise<EnqueueResult> {
  let id: string;
  try {
    id = outboxId(categoryOf(input.template, input.variables), input.objectId, input.uid, input.revisionOrWindow);
  } catch {
    return { enqueued: false, id: "", reason: "invalid_input" };
  }
  if (input.uid.length === 0 || input.companyId.length === 0) return { enqueued: false, id, reason: "invalid_input" };
  const variables = deps.validate(input.template, input.variables);
  if (variables === null) return { enqueued: false, id, reason: "invalid_variables" };
  const created = await deps.outbox.create(
    { id, uid: input.uid, companyId: input.companyId, template: input.template, variables, notAfter: input.notAfter ?? null },
    deps.clock.now(),
  );
  return created ? { enqueued: true, id } : { enqueued: false, id, reason: "duplicate" };
}

export interface ChannelDeps extends EnqueueDeps {
  companies: CompanySettingsReader;
  preferences: EmailPreferencesStore;
  config: { enabled: boolean };
}

export interface EmailCandidate extends EnqueueInput {
  /** Per-event subscription level for event-scoped kinds (null = no subscription document, treated as `none`). */
  eventLevel: SubscriptionLevel | null;
  /** Push will be delivered for this same notification (the router knows after its own push evaluation). */
  pushWillDeliver: boolean;
}

export interface ChannelResult { decision: EmailRoutingDecision; enqueue: EnqueueResult | null }

/** Email channel of the shared push router: decides per recipient with the shared precedence rule, then enqueues once. */
export async function emailChannel(deps: ChannelDeps, candidate: EmailCandidate): Promise<ChannelResult> {
  if (!deps.config.enabled) return { decision: { send: false, reason: "disabled" }, enqueue: null };
  const kind = templateKind(candidate.template, candidate.variables as { outcome?: string; window?: string });
  // Account emails have no notification kind and never come through the shared router.
  if (kind === null) return { decision: { send: false, reason: "category_off" }, enqueue: null };
  const company = await deps.companies.get(candidate.companyId);
  const emailMap = await deps.preferences.getEmailMap(candidate.uid);
  const decision = decideEmail({
    kind,
    globalEnabled: deps.config.enabled,
    companyEnabled: company?.enabled === true,
    preferences: resolvePreferences({ email: emailMap ?? {} }),
    eventLevel: candidate.eventLevel,
    pushWillDeliver: candidate.pushWillDeliver,
  });
  if (!decision.send) return { decision, enqueue: null };
  return { decision, enqueue: await enqueueEmail(deps, candidate) };
}
