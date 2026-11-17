import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { runWeeklyThemePushes } from "../application/newTriggers";
import { deliverNotification } from "../application/router";
import { FirestoreThemes } from "../infrastructure/firestoreThemes";
import { routerDependencies } from "./routerDeps";

/**
 * Monday 09:00 America/New_York: pushes the weekly theme that started within the last 24 hours to every active
 * member of its company. Decision (push-triggers owner question 3 is open): there is no per-company time zone
 * yet, so one fixed zone is used; replace it with the company zone once that field exists. Always uses the
 * router; receipts make a retry or a second run idempotent.
 */
export const sendWeeklyThemePushes = onSchedule(
  {
    schedule: "every monday 09:00", timeZone: "America/New_York", region: "us-central1", retryCount: 1,
    timeoutSeconds: 540, memory: "512MiB", maxInstances: 1,
  },
  async () => {
    const app = defaultAdminApp();
    const themes = new FirestoreThemes(getFirestore(app));
    const stats = await runWeeklyThemePushes({
      themes, members: themes, now: () => new Date(),
      deliver: (request) => deliverNotification(routerDependencies(app), request),
    });
    logger.info("weekly theme pushes", stats);
  });
