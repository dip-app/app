import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { FirestoreAdminRateLimiter, FirestoreAdminStore } from "../../admin/infrastructure/firestoreAdminStore";
import { AdminError } from "../../admin/domain/errors";
import { toHttpsError } from "../../admin/transport/adminCallables";
import type { Caller as AdminCaller } from "../../admin/application/ports";
import type { DecisionPort } from "../../ai/application/ports";
import { aiConfig, secretPresent } from "../../ai/infrastructure/aiConfig";
import { DemoDecisions } from "../../ai/infrastructure/demo";
import { FirestoreInterestSource, FirestoreTagCatalog } from "../../ai/infrastructure/firestoreSources";
import { JevDecisions } from "../../ai/infrastructure/jevDecisions";
import { OpenAiDecisions } from "../../ai/infrastructure/openAiDecisions";
import { createOpenAiLlm } from "../../ai/infrastructure/openaiLlm";
import { providerFromEnv, settingsFromEnv } from "../../ai/infrastructure/settings";
import { renderer as emailRenderer, emailConfig, EMAIL_UNSUBSCRIBE_KEY } from "../../email/transport/emailFunctions";
import { FirestoreEmailStore } from "../../email/infrastructure/firestoreEmailStore";
import { FirestorePreferences } from "../../notifications/infrastructure/firestorePreferences";
import { callerFromRequest } from "../../organizer/transport/organizerCallables";
import { firestoreBudget } from "../application/budget";
import { manageSuggestionsEmail, type ManageDeps } from "../application/manage";
import type { BuildDeps, SuggestionEngines, SuggestionsConfig } from "../application/ports";
import { resolveSuggestedIdea, type ResolveDeps } from "../application/resolveIdea";
import { runWeeklySuggestions, type WeeklyJobDeps } from "../application/weeklyJob";
import { FirestoreSuggestionsStore } from "../infrastructure/firestoreSuggestionsStore";

/**
 * Weekly admin ideas email (docs/design/stretch/admin-suggestions-email.md). Secrets are created by the owner in Secret
 * Manager (see the AI module); values are read inside handlers only and never logged. Nothing runs unless
 * EMAIL_ENABLED, the company's email switch and the AI switches are on, and an admin opted in.
 */
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const JEV_API_KEY = defineSecret("JEV_API_KEY");

const REGION = "us-central1";

function secret(param: { value(): string }): string | undefined {
  try {
    const value = param.value();
    return secretPresent(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const log = (event: string, fields: Readonly<Record<string, string | number | boolean | null>>) => logger.info(event, fields);

function suggestionsConfig(): SuggestionsConfig {
  const email = emailConfig();
  return { emailEnabled: email.enabled, defaultTimeZone: email.defaultTimeZone, signingKey: email.unsubscribeKey, origin: email.publicOrigin };
}

/**
 * Engine slots: Jev when `SUGGESTIONS_DECISION_PROVIDER` is `jev` (default) and a real Jev key exists; OpenAI mini when a
 * key exists; the demo decisions fill the OpenAI slot for the emulator and AI_PROVIDER=demo. Nothing else is called.
 */
function engines(withJev: boolean): { engines: SuggestionEngines; models: BuildDeps["models"] } {
  const config = aiConfig(process.env);
  const models = { jev: config.draftCheck.jevModel, openai: config.draftCheck.openaiModel };
  if (providerFromEnv(process.env) === "demo") return { engines: { jev: null, openai: new DemoDecisions() }, models };
  const preferred = process.env.SUGGESTIONS_DECISION_PROVIDER?.trim().toLowerCase() === "openai-mini" ? "openai-mini" : "jev";
  const jevKey = withJev && preferred === "jev" ? secret(JEV_API_KEY) : undefined;
  const openaiKey = secret(OPENAI_API_KEY);
  const jev: DecisionPort | null = jevKey ? new JevDecisions({ apiKey: jevKey, model: models.jev }) : null;
  const openai: DecisionPort | null = openaiKey ? new OpenAiDecisions(createOpenAiLlm(openaiKey, config), config) : null;
  return { engines: { jev, openai }, models };
}

let tagCatalog: FirestoreTagCatalog | null = null;

function parts(withJev: boolean) {
  const db = getFirestore(defaultAdminApp());
  tagCatalog ??= new FirestoreTagCatalog(db);
  const openaiKey = secret(OPENAI_API_KEY);
  const settings = settingsFromEnv(process.env, { openai: openaiKey });
  const adminStore = new FirestoreAdminStore(db);
  const emailStore = new FirestoreEmailStore(db);
  const { engines: slots, models } = engines(withJev);
  const build: BuildDeps = {
    store: new FirestoreSuggestionsStore(db), interests: new FirestoreInterestSource(db), catalog: tagCatalog, engines: slots, models,
    budget: firestoreBudget(adminStore, settings), log,
  };
  const enqueue = { outbox: emailStore.outbox, clock: { now: () => new Date() }, validate: emailRenderer.validate };
  return { db, adminStore, emailStore, settings, build, enqueue, config: suggestionsConfig() };
}

/** Hourly (UTC): every company whose local schedule is due gets its digest built once and one email per opted-in admin. */
export const sendAdminSuggestionsEmails = onSchedule(
  {
    schedule: "0 * * * *", timeZone: "Etc/UTC", region: REGION, secrets: [EMAIL_UNSUBSCRIBE_KEY, JEV_API_KEY, OPENAI_API_KEY],
    timeoutSeconds: 540, memory: "512MiB",
  },
  async () => {
    const p = parts(true);
    const deps: WeeklyJobDeps = { build: p.build, enqueue: p.enqueue, preferences: p.emailStore.preferences, settings: p.settings, config: p.config, log };
    const summary = await runWeeklySuggestions(deps, new Date());
    if (summary.failed > 0) logger.warn("suggestions job finished with failures", { failed: summary.failed });
  });

// Production requires App Check; only the official Functions emulator bypasses it.
const base = { region: REGION, enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" } as const;

async function run<T>(name: string, request: CallableRequest, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const httpsError = toHttpsError(error);
    if (httpsError.code === "internal") {
      logger.error(`${name} failed`, {
        uid: request.auth?.uid ?? null, reason: error instanceof AdminError ? error.reason : "UNEXPECTED", error: error instanceof Error ? error.name : "unknown",
      });
    }
    throw httpsError;
  }
}

export const manageSuggestionsEmailV1 = onCall(
  { ...base, secrets: [EMAIL_UNSUBSCRIBE_KEY, JEV_API_KEY, OPENAI_API_KEY], timeoutSeconds: 300, memory: "512MiB" },
  (request: CallableRequest) => run("manageSuggestionsEmailV1", request, () => {
    const p = parts(true);
    const deps: ManageDeps = {
      admin: p.adminStore, build: p.build, enqueue: p.enqueue, preferences: p.emailStore.preferences, writer: new FirestorePreferences(p.db),
      settings: p.settings, config: p.config, limiter: new FirestoreAdminRateLimiter(p.db), log, now: () => new Date(),
    };
    return manageSuggestionsEmail(deps, callerFromRequest(request) as AdminCaller | null, request.data);
  }));

export const resolveSuggestedIdeaV1 = onCall(
  { ...base, secrets: [EMAIL_UNSUBSCRIBE_KEY] },
  (request: CallableRequest) => run("resolveSuggestedIdeaV1", request, () => {
    const db = getFirestore(defaultAdminApp());
    const deps: ResolveDeps = {
      admin: new FirestoreAdminStore(db), store: new FirestoreSuggestionsStore(db), signingKey: suggestionsConfig().signingKey,
      limiter: new FirestoreAdminRateLimiter(db), now: () => new Date(),
    };
    return resolveSuggestedIdea(deps, callerFromRequest(request) as AdminCaller | null, request.data);
  }));
