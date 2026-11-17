import type { App } from "firebase-admin/app";
import { logger } from "firebase-functions/v2";
import { RoutedPushNotifier } from "../application/newTriggers";
import { deliverNotification } from "../application/router";
import { routerDependencies } from "./routerDeps";

/**
 * Post-commit pushes for the new triggers (attendee added, invite accepted, challenge reviewed). These always
 * use the router regardless of PUSH_ROUTER_ENABLED. Each delivery builds fresh router dependencies (fresh
 * preference cache); failures are logged by kind and reason code only, never names, titles or tokens.
 */
export function routedPushNotifier(app: App): RoutedPushNotifier {
  return new RoutedPushNotifier(
    (request) => deliverNotification(routerDependencies(app), request),
    (kind, reason) => logger.warn("push delivery failed", { kind, reason }),
  );
}
