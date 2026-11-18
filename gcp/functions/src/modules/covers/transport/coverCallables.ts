import { onCall } from "firebase-functions/v2/https";
import { base, command, deps, JEV_API_KEY, OPENAI_API_KEY } from "../../ai/transport/aiCallables";
import { pickEventCover } from "../application/pickCover";

/**
 * pickEventCoverV1 (PickEventCoverRequest -> PickEventCoverResponse): "Let Dipbot choose" for an event cover. Same
 * caller checks and burst limiter as generateEventDraftsV1 (admin, ai.generate); the decision wiring is the shared AI
 * one (Jev, then the cheap OpenAI model, then the heuristic), so it needs the same two secrets. The model is consulted
 * only when AI_EVENTS_ENABLED is "true"; otherwise (or on any provider failure) the deterministic text match answers.
 * No credits are charged: the optional `credits` hook of the application service is not wired yet.
 */
export const pickEventCoverV1 = onCall(
  { ...base, secrets: [OPENAI_API_KEY, JEV_API_KEY], timeoutSeconds: 60, memory: "256MiB", maxInstances: 5 },
  command("pickEventCoverV1", (d, caller, data) =>
    pickEventCover({
      store: d.store, decisions: d.decisions, aiEnabled: process.env.AI_EVENTS_ENABLED === "true", now: d.now, ...(d.coverLimits ? { limits: d.coverLimits } : {}),
      ...(d.limiter ? { limiter: d.limiter } : {}), ...(d.log ? { log: d.log } : {}),
    }, caller, data)),
);
