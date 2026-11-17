import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { AdminError } from "../../admin/domain/errors";
import { toHttpsError } from "../../admin/transport/adminCallables";
import { callerFromRequest } from "../../organizer/transport/organizerCallables";
import { FirestoreAdminRateLimiter, FirestoreAdminStore } from "../../admin/infrastructure/firestoreAdminStore";
import { LlmUnavailableError, type LlmPort } from "../application/ports";
import { getEventIdeaSuggestions, type SuggestionDeps, type SuggestionProvider } from "../application/suggestions";
import { aiConfig, secretPresent } from "../infrastructure/aiConfig";
import { FirestoreInterestSource, FirestoreTagCatalog, FirestoreThemeSource } from "../infrastructure/firestoreSources";
import { JevDecisions } from "../infrastructure/jevDecisions";
import { OpenAiDecisions } from "../infrastructure/openAiDecisions";
import { createOpenAiLlm } from "../infrastructure/openaiLlm";
import { providerFromEnv, settingsFromEnv } from "../infrastructure/settings";
import { DemoSuggestionDecisions, FirestorePastEvents } from "../infrastructure/suggestionSources";

/**
 * getEventIdeaSuggestionsV1 (additive; see application/suggestions.ts). Same secrets as the generator, read inside the
 * handler only and never logged. Provider order: Jev when JEV_API_KEY holds a real key, then the OpenAI mini model
 * of the triage step (AI_MODEL_TRIAGE), then the deterministic heuristic.
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

function deps(): SuggestionDeps {
  const db = getFirestore(defaultAdminApp());
  catalog ??= new FirestoreTagCatalog(db);
  const config = aiConfig(process.env);
  const openaiKey = secret(OPENAI_API_KEY);
  const settings = settingsFromEnv(process.env, { openai: openaiKey });
  const providers: SuggestionProvider[] = [];
  if (providerFromEnv(process.env) === "demo") {
    providers.push({ port: new DemoSuggestionDecisions(), model: "demo" });
  } else {
    const jevKey = secret(JEV_API_KEY);
    if (jevKey) providers.push({ port: new JevDecisions({ apiKey: jevKey, model: config.triage.jevModel }), model: config.triage.jevModel });
    if (openaiKey) providers.push({ port: new OpenAiDecisions(createOpenAiLlm(openaiKey, config), config), model: config.triage.openaiModel });
  }
  return {
    store: new FirestoreAdminStore(db), llm: unavailableLlm, decisions: providers[0]?.port ?? { decide: async () => { throw new LlmUnavailableError(null); } },
    interests: new FirestoreInterestSource(db), catalog, themes: new FirestoreThemeSource(db), pastEvents: new FirestorePastEvents(db), providers,
    settings, limiter: new FirestoreAdminRateLimiter(db), now: () => new Date(),
    log: (event, fields) => logger.info(event, fields),
  };
}

const base = { region: "us-central1", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" } as const;

export const getEventIdeaSuggestionsV1 = onCall(
  { ...base, secrets: [OPENAI_API_KEY, JEV_API_KEY], timeoutSeconds: 60, memory: "256MiB", maxInstances: 10 },
  async (request: CallableRequest) => {
    try {
      return await getEventIdeaSuggestions(deps(), callerFromRequest(request), request.data);
    } catch (error) {
      const httpsError = toHttpsError(error);
      if (httpsError.code === "internal") {
        logger.error("getEventIdeaSuggestionsV1 failed", {
          uid: request.auth?.uid ?? null, reason: error instanceof AdminError ? error.reason : "UNEXPECTED", error: error instanceof Error ? error.name : "unknown",
        });
      }
      throw httpsError;
    }
  },
);
