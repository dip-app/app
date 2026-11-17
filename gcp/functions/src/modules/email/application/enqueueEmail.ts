import { resolveEmailPreferences } from "../domain/categories";
import { categoryOf, outboxId } from "../domain/outbox";
import { decideEmail, type EmailRoutingDecision } from "../domain/policy";
import type { TemplateId, TemplateVariables } from "../domain/templates/types";
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
    id = outboxId(categoryOf(input.template), input.objectId, input.uid, input.revisionOrWindow);
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
  eventScoped: boolean;
  /** Per-event subscription level, or null when not event-scoped. */
  eventLevel: string | null;
  pushWillDeliver: boolean;
}

export interface ChannelResult { decision: EmailRoutingDecision; enqueue: EnqueueResult | null }

/** Email channel of the shared push router: decides per recipient, then enqueues. */
export async function emailChannel(deps: ChannelDeps, candidate: EmailCandidate): Promise<ChannelResult> {
  const category = categoryOf(candidate.template);
  if (!deps.config.enabled) return { decision: { send: false, reason: "disabled" }, enqueue: null };
  const company = await deps.companies.get(candidate.companyId);
  const preference = resolveEmailPreferences(await deps.preferences.getEmailMap(candidate.uid))[category];
  const decision = decideEmail({
    category,
    globalEnabled: deps.config.enabled,
    companyEnabled: company?.enabled === true,
    emailPreference: preference,
    eventLevel: candidate.eventLevel,
    eventScoped: candidate.eventScoped,
    pushWillDeliver: candidate.pushWillDeliver,
  });
  if (!decision.send) return { decision, enqueue: null };
  return { decision, enqueue: await enqueueEmail(deps, candidate) };
}
