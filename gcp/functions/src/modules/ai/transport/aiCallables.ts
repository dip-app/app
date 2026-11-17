import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { AdminError } from "../../admin/domain/errors";
import { toHttpsError } from "../../admin/transport/adminCallables";
import { callerFromRequest } from "../../organizer/transport/organizerCallables";
import { FirestoreAdminRateLimiter, FirestoreAdminStore } from "../../admin/infrastructure/firestoreAdminStore";
import { getEventIdeaContext } from "../application/context";
import { generateEventDrafts } from "../application/generate";
import { LlmUnavailableError } from "../application/ports";
import type { AiDeps, Caller, DecisionPort, LlmPort } from "../application/ports";
import { aiConfig, secretPresent } from "../infrastructure/aiConfig";
import { DemoDecisions, DemoLlm } from "../infrastructure/demo";
import { FirestoreInterestSource, FirestoreTagCatalog, FirestoreThemeSource } from "../infrastructure/firestoreSources";
import { JevDecisions } from "../infrastructure/jevDecisions";
import { OpenAiDecisions } from "../infrastructure/openAiDecisions";
import { createOpenAiLlm } from "../infrastructure/openaiLlm";
import { providerFromEnv, settingsFromEnv } from "../infrastructure/settings";
import { HeuristicDecisions } from "../infrastructure/heuristicDecisions";
import { StepDecisions } from "../infrastructure/stepDecisions";

/**
 * Secrets live in Secret Manager and are created by the owner, never by code:
 *   firebase functions:secrets:set OPENAI_API_KEY
 *   firebase functions:secrets:set JEV_API_KEY   (`none` turns Jev off; then OpenAI answers the decision steps)
 * Values are read inside the handler only, through `.value()`, and are never logged. The emulator and
 * AI_PROVIDER=demo use the offline demo adapters and need neither. OPENAI_API_KEY is bound to both callables so the
 * context callable can report the feature as disabled when the key is absent; JEV_API_KEY to both so the reserved
 * worst case (which includes the OpenAI fallback of a Jev step) is the same in both.
 */
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const JEV_API_KEY = defineSecret("JEV_API_KEY");

let catalog: FirestoreTagCatalog | null = null;

function secret(param: { value(): string }): string | undefined {
  try {
    const value = param.value();
    return secretPresent(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const unavailableLlm: LlmPort = {
  generate: async () => { throw new LlmUnavailableError(null); },
  moderate: async () => { throw new LlmUnavailableError(null); },
};

function deps(): AiDeps {
  const db = getFirestore(defaultAdminApp());
  catalog ??= new FirestoreTagCatalog(db);
  const config = aiConfig(process.env);
  const openaiKey = secret(OPENAI_API_KEY);
  const demo = providerFromEnv(process.env) === "demo";
  const jevKey = secret(JEV_API_KEY);
  const settings = settingsFromEnv(process.env, { openai: openaiKey, jev: jevKey });
  let llm: LlmPort;
  let decisions: DecisionPort;
  if (demo) {
    llm = new DemoLlm();
    decisions = new DemoDecisions();
  } else {
    llm = openaiKey ? createOpenAiLlm(openaiKey, config) : unavailableLlm;
    // Jev answers every decision step by default when its key is real; a failed Jev call falls back to the OpenAI
    // model, then to the deterministic heuristics. The answering provider is logged and stored on the request doc.
    const jev = jevKey ? new JevDecisions({ apiKey: jevKey, model: config.triage.jevModel }) : null;
    decisions = new StepDecisions(config, jev, openaiKey ? new OpenAiDecisions(llm, config) : null, new HeuristicDecisions());
  }
  return {
    store: new FirestoreAdminStore(db), llm, decisions, interests: new FirestoreInterestSource(db), catalog,
    themes: new FirestoreThemeSource(db), settings, limiter: new FirestoreAdminRateLimiter(db), now: () => new Date(),
    // Ids, counts, model and outcome only: never the note, the prompt or the drafts.
    log: (event, fields) => logger.info(event, fields),
  };
}

type Run<T> = (deps: AiDeps, caller: Caller | null, data: unknown) => Promise<T>;

// Production requires App Check; only the official Functions emulator bypasses it.
const base = { region: "us-central1", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" } as const;

/** Runs one command and maps failures like the admin commands; payloads and notes are never logged. */
const command = <T>(name: string, run: Run<T>) => async (request: CallableRequest): Promise<T> => {
  try {
    return await run(deps(), callerFromRequest(request), request.data);
  } catch (error) {
    const httpsError = toHttpsError(error);
    if (httpsError.code === "internal") {
      logger.error(`${name} failed`, {
        uid: request.auth?.uid ?? null, reason: error instanceof AdminError ? error.reason : "UNEXPECTED", error: error instanceof Error ? error.name : "unknown",
      });
    }
    throw httpsError;
  }
};

export const getEventIdeaContextV1 = onCall(
  { ...base, secrets: [OPENAI_API_KEY, JEV_API_KEY] },
  command("getEventIdeaContextV1", getEventIdeaContext),
);
export const generateEventDraftsV1 = onCall(
  { ...base, secrets: [OPENAI_API_KEY, JEV_API_KEY], timeoutSeconds: 300, memory: "512MiB" },
  command("generateEventDraftsV1", generateEventDrafts),
);
