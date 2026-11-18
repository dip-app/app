import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { AdminError } from "../../admin/domain/errors";
import { toHttpsError } from "../../admin/transport/adminCallables";
import { callerFromRequest } from "../../organizer/transport/organizerCallables";
import { FirestoreAdminRateLimiter, FirestoreAdminStore } from "../../admin/infrastructure/firestoreAdminStore";
import { FirestoreSuggestionsStore } from "../../suggestions/infrastructure/firestoreSuggestionsStore";
import { getDipbotIdeas, type IdeasDeps } from "../application/ideas";
import { LlmUnavailableError, type LlmPort } from "../application/ports";
import type { SuggestionProvider } from "../application/suggestions";
import { aiConfig, secretPresent } from "../infrastructure/aiConfig";
import { DemoAgentModel } from "../infrastructure/demo";
import { FirestoreInterestSource, FirestoreTagCatalog, FirestoreThemeSource } from "../infrastructure/firestoreSources";
import { JevDecisions } from "../infrastructure/jevDecisions";
import { OpenAiDecisions } from "../infrastructure/openAiDecisions";
import { createOpenAiAgentModel } from "../infrastructure/openAiAgent";
import { createOpenAiLlm } from "../infrastructure/openaiLlm";
import { providerFromEnv, settingsFromEnv } from "../infrastructure/settings";
import { DemoSuggestionDecisions } from "../infrastructure/suggestionSources";

/**
 * getDipbotIdeasV1 (see application/ideas.ts). Same secrets as the other AI callables, read inside the handler only and
 * never logged. The agent is the AI_MODEL_IDEAS model on OpenAI; ranking tries Jev (when JEV_API_KEY holds a real key)
 * then the OpenAI mini model. In the emulator an offline demo agent and demo ranking answer, so the portal works without keys.
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

function deps(): IdeasDeps {
  const db = getFirestore(defaultAdminApp());
  catalog ??= new FirestoreTagCatalog(db);
  const config = aiConfig(process.env);
  const openaiKey = secret(OPENAI_API_KEY);
  const settings = settingsFromEnv(process.env, { openai: openaiKey });
  const demo = providerFromEnv(process.env) === "demo";
  const rankers: SuggestionProvider[] = [];
  if (demo) {
    rankers.push({ port: new DemoSuggestionDecisions(), model: "demo" });
  } else {
    const jevKey = secret(JEV_API_KEY);
    if (jevKey) rankers.push({ port: new JevDecisions({ apiKey: jevKey, model: config.draftCheck.jevModel }), model: config.draftCheck.jevModel });
    if (openaiKey) rankers.push({ port: new OpenAiDecisions(createOpenAiLlm(openaiKey, config), config), model: config.draftCheck.openaiModel });
  }
  const agent = demo ? new DemoAgentModel() : openaiKey ? createOpenAiAgentModel(openaiKey, config.ideas.model, config.ideas.effort) : null;
  return {
    store: new FirestoreAdminStore(db), llm: unavailableLlm, decisions: rankers[0]?.port ?? { decide: async () => { throw new LlmUnavailableError(null); } },
    interests: new FirestoreInterestSource(db), catalog, themes: new FirestoreThemeSource(db), signals: new FirestoreSuggestionsStore(db),
    agent, rankers, provider: demo ? "demo" : "openai", settings, limiter: new FirestoreAdminRateLimiter(db), now: () => new Date(),
    log: (event, fields) => logger.info(event, fields),
  };
}

const base = { region: "us-central1", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" } as const;

export const getDipbotIdeasV1 = onCall(
  { ...base, secrets: [OPENAI_API_KEY, JEV_API_KEY], timeoutSeconds: 60, memory: "512MiB", maxInstances: 10 },
  async (request: CallableRequest) => {
    try {
      return await getDipbotIdeas(deps(), callerFromRequest(request), request.data);
    } catch (error) {
      const httpsError = toHttpsError(error);
      if (httpsError.code === "internal") {
        logger.error("getDipbotIdeasV1 failed", {
          uid: request.auth?.uid ?? null, reason: error instanceof AdminError ? error.reason : "UNEXPECTED", error: error instanceof Error ? error.name : "unknown",
        });
      }
      throw httpsError;
    }
  },
);
