import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";
import { onCall, onRequest } from "firebase-functions/v2/https";
import { base, command, JEV_API_KEY, OPENAI_API_KEY } from "../../ai/transport/aiCallables";
import { aiConfig, secretPresent } from "../../ai/infrastructure/aiConfig";
import { providerFromEnv } from "../../ai/infrastructure/settings";
import { pickEventCover } from "../application/pickCover";
import type { LiveCoverDeps } from "../application/livePorts";
import { handleCoverImage } from "../infrastructure/coverImageHandler";
import { buildLiveCoverDeps, coverObjectReader, dynamicCoverCatalog } from "./liveWiring";

/**
 * Create the secret with `firebase functions:secrets:set PIXABAY_API_KEY` (the owner does; `none` turns the live
 * fallback off). Read inside the handler only, through `.value()`; never logged.
 */
export const PIXABAY_API_KEY = defineSecret("PIXABAY_API_KEY");

/** Live deps, or undefined when the key is absent or a placeholder, or the offline demo provider is active. */
async function liveDeps(): Promise<LiveCoverDeps | undefined> {
  if (providerFromEnv(process.env, () => undefined) === "demo") return undefined;
  let key: string;
  try { key = PIXABAY_API_KEY.value(); } catch { return undefined; }
  if (!secretPresent(key)) return undefined;
  try {
    return await buildLiveCoverDeps(aiConfig(process.env).coverLive, key.trim());
  } catch {
    logger.warn("ai.cover_live_wiring_failed", {});
    return undefined;
  }
}

/**
 * pickEventCoverV1 (PickEventCoverRequest -> PickEventCoverResponse): "Let Dipbot choose" for an event cover. Same
 * caller checks and burst limiter as generateEventDraftsV1 (admin, ai.generate); the decision wiring is the shared AI
 * one (Jev, then the cheap OpenAI model, then the heuristic), so it needs the same two secrets. The model is consulted
 * only when AI_EVENTS_ENABLED is "true"; otherwise (or on any provider failure) the deterministic text match answers.
 * One Dipbot credit is charged when a model answers (refunded otherwise). When the library has no good match and
 * PIXABAY_API_KEY is set, the live Pixabay fallback may add one fresh photo (AI_COVER_LIVE_FALLBACK=false turns it off).
 * It also runs the Pixabay search, download, image processing and storing, hence the longer timeout and more memory.
 */
export const pickEventCoverV1 = onCall(
  { ...base, secrets: [OPENAI_API_KEY, JEV_API_KEY, PIXABAY_API_KEY], timeoutSeconds: 90, memory: "512MiB", maxInstances: 5 },
  command("pickEventCoverV1", async (d, caller, data) => {
    const aiEnabled = process.env.AI_EVENTS_ENABLED === "true";
    const live = aiEnabled ? await liveDeps() : undefined;
    return pickEventCover({
      store: d.store, decisions: d.decisions, aiEnabled, now: d.now, ...(d.coverLimits ? { limits: d.coverLimits } : {}),
      ...(d.limiter ? { limiter: d.limiter } : {}), ...(d.log ? { log: d.log } : {}), ...(live ? { live } : {}),
      // Stored fresh photos stay reusable when the Pixabay key is absent or the fallback is switched off.
      ...(aiEnabled && providerFromEnv(process.env, () => undefined) !== "demo" ? { dynamic: dynamicCoverCatalog() } : {}),
    }, caller, data);
  }),
);

/**
 * coverImageV1: serves stored dynamic cover images behind the Hosting rewrite `/img/covers-dyn/**` (WebP for the apps, JPEG
 * for emails and share previews). Public, GET and HEAD only, strict path patterns, immutable cache headers; the objects
 * live in the server-only Storage prefix covers-dynamic/ (storage.rules denies every client).
 */
export const coverImageV1 = onRequest(
  { region: "us-central1", memory: "256MiB", maxInstances: 10, concurrency: 80, invoker: "public" },
  async (request, response) => {
    try {
      const result = await handleCoverImage(request.method, request.path, coverObjectReader());
      response.status(result.status);
      for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
      if (result.body) response.end(result.body); else response.end();
    } catch {
      logger.error("coverImageV1 failed", {});
      response.status(500).setHeader("Cache-Control", "no-store").end();
    }
  },
);
