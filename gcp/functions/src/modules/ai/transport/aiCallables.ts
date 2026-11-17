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
import type { AiDeps, Caller, LlmPort } from "../application/ports";
import { createAnthropicLlm } from "../infrastructure/anthropicLlm";
import { DemoLlm } from "../infrastructure/fakeLlm";
import { FirestoreInterestSource, FirestoreTagCatalog, FirestoreThemeSource } from "../infrastructure/firestoreSources";
import { providerFromEnv, settingsFromEnv } from "../infrastructure/settings";

/**
 * Secret Manager secret holding the Anthropic API key (owner action: `firebase functions:secrets:set ANTHROPIC_API_KEY`).
 * Only generateEventDraftsV1 binds it, and it is read inside the handler only. The emulator and AI_PROVIDER=demo use the
 * offline DemoLlm and never read it.
 */
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

let catalog: FirestoreTagCatalog | null = null;

function deps(llm: () => LlmPort): AiDeps {
  const db = getFirestore(defaultAdminApp());
  catalog ??= new FirestoreTagCatalog(db);
  const settings = settingsFromEnv(process.env);
  return {
    store: new FirestoreAdminStore(db), llm: llm(), interests: new FirestoreInterestSource(db), catalog,
    themes: new FirestoreThemeSource(db), settings, limiter: new FirestoreAdminRateLimiter(db), now: () => new Date(),
    // Ids, counts, model and outcome only: never the note, the prompt or the drafts.
    log: (event, fields) => logger.info(event, fields),
  };
}

function llmFromEnv(): LlmPort {
  if (providerFromEnv(process.env) === "demo") return new DemoLlm();
  const settings = settingsFromEnv(process.env);
  return createAnthropicLlm(ANTHROPIC_API_KEY.value(), { generateModel: settings.generateModel, screenModel: settings.screenModel });
}

type Run<T> = (deps: AiDeps, caller: Caller | null, data: unknown) => Promise<T>;
const unusedLlm = (): LlmPort => ({ complete: async () => { throw new Error("No model calls in this command."); } });

// Production requires App Check; only the official Functions emulator bypasses it.
const base = { region: "us-central1", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" } as const;

/** Runs one command and maps failures like the admin commands; payloads and notes are never logged. */
const command = <T>(name: string, run: Run<T>, llm: () => LlmPort) => async (request: CallableRequest): Promise<T> => {
  try {
    return await run(deps(llm), callerFromRequest(request), request.data);
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

export const getEventIdeaContextV1 = onCall(base, command("getEventIdeaContextV1", getEventIdeaContext, unusedLlm));
export const generateEventDraftsV1 = onCall(
  { ...base, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 180, memory: "512MiB" },
  command("generateEventDraftsV1", generateEventDrafts, llmFromEnv),
);
