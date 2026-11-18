import { logger } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";
import { adminCommands } from "../../admin/transport/adminCallables";
import { challengeCommands } from "../../challenges/transport/challengeCallables";
import { organizerCommands } from "../../organizer/transport/organizerCallables";
import { placeCommands } from "../../places/transport/placesCallables";
import { submissionReviewCommands } from "../../submissions/transport/submissionCallables";
import { createDispatcher } from "./dispatch";
import { buildRegistry, type HandlerSets } from "./registry";

/** The production handler sets: the same objects the standalone `onCall` exports use. */
export const productionHandlers: HandlerSets = {
  admin: adminCommands,
  organizer: organizerCommands,
  challenges: challengeCommands,
  submissions: submissionReviewCommands,
  places: placeCommands,
};

export const productionRegistry = buildRegistry(productionHandlers);

/**
 * The options. One warm instance (minInstances 1) serves every migrated command; 1 vCPU (the gen2 default at
 * 512 MiB, set explicitly so the cost estimate holds) with the default concurrency of 80. maxInstances bounds cost and
 * Firestore fan-out like the admin callables' cap of 10. Production requires App Check; only the official Functions
 * emulator bypasses it.
 */
export const dipApiOptions = {
  region: "us-central1", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true",
  memory: "512MiB", cpu: 1, timeoutSeconds: 60, minInstances: 1, maxInstances: 10,
} as const;

/**
 * dipApiV1 ({ command, payload } -> that command's response). An additive transport for the admin portal; every
 * standalone callable stays deployed and unchanged for shipped iOS builds. Log lines carry the command name,
 * outcome, timing and sizes only (no uid, payload or response).
 */
export const dipApiV1 = onCall(dipApiOptions, createDispatcher(productionRegistry, {
  log: entry => (entry.outcome === "internal" ? logger.error("dipApi.dispatch", entry) : logger.info("dipApi.dispatch", entry)),
}));
