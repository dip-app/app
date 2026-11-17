import type { PushMessage } from "../domain/push";
import type { DeviceToken, PushDependencies } from "./ports";
import type { DeliveryLog } from "./routerPorts";

/** FCM sendEachForMulticast accepts at most 500 tokens per call. */
export const MULTICAST_LIMIT = 500;

/** Tokens FCM will never accept again; their registry documents are deleted. */
export const INVALID_TOKEN_ERRORS: ReadonlySet<string> = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/**
 * FCM codes that mean our credentials or project setup are wrong (for example a missing or wrong APNs key), not that
 * a single token is stale. When every send fails with one of these the log is an error so alerting can see it.
 */
export const CREDENTIAL_ERRORS: ReadonlySet<string> = new Set([
  "messaging/third-party-auth-error",
  "messaging/authentication-error",
  "messaging/invalid-apns-credentials",
  "messaging/mismatched-credential",
]);

/** Non-sensitive identifiers attached to send logs. Never tokens, emails, names or message text. */
export interface SendContext { notificationId?: string; kind?: string; companyId?: string }

export interface PushStats { recipients: number; tokens: number; sent: number; failed: number; removed: number }

/**
 * Sends one message to already-resolved devices: dedupes by token, sends in multicast batches of <=500 and
 * removes tokens FCM reports as unregistered/invalid. A failed batch is counted, never retried here (pushes
 * are best-effort, at most once per claim). `recipients` is the number of distinct users among the devices.
 */
export async function sendToDevices(
  deps: Pick<PushDependencies, "messaging" | "devices"> & { logger?: DeliveryLog }, devices: readonly DeviceToken[], message: PushMessage, context: SendContext = {},
): Promise<PushStats> {
  // The same token can only be registered under one user, but guard against duplicates anyway.
  const byToken = new Map<string, DeviceToken>();
  for (const device of devices) if (!byToken.has(device.token)) byToken.set(device.token, device);
  const targets = [...byToken.values()];
  const stats: PushStats = { recipients: new Set(targets.map((device) => device.uid)).size, tokens: targets.length, sent: 0, failed: 0, removed: 0 };
  const invalid: DeviceToken[] = [];
  const errorCodes: Record<string, number> = {};
  let failedBatches = 0;
  for (let offset = 0; offset < targets.length; offset += MULTICAST_LIMIT) {
    const batch = targets.slice(offset, offset + MULTICAST_LIMIT);
    let results;
    try {
      results = await deps.messaging.sendMulticast(batch.map((device) => device.token), message);
    } catch (error) {
      stats.failed += batch.length;
      failedBatches++;
      const code = (error as { code?: unknown } | null)?.code;
      const key = typeof code === "string" ? code : "batch_exception";
      errorCodes[key] = (errorCodes[key] ?? 0) + batch.length;
      continue;
    }
    batch.forEach((device, index) => {
      const result = results[index];
      if (result?.success) { stats.sent++; return; }
      stats.failed++;
      const code = result?.errorCode ?? "unknown";
      errorCodes[code] = (errorCodes[code] ?? 0) + 1;
      if (result?.errorCode && INVALID_TOKEN_ERRORS.has(result.errorCode)) invalid.push(device);
    });
  }
  if (invalid.length) {
    await deps.devices.remove(invalid);
    stats.removed = invalid.length;
  }
  logSendOutcome(deps.logger, stats, errorCodes, failedBatches, context);
  return stats;
}

/** Stale-token errors are routine and only counted; anything else is a warning, and total credential failure is an error. */
function logSendOutcome(log: DeliveryLog | undefined, stats: PushStats, errorCodes: Record<string, number>, failedBatches: number, context: SendContext): void {
  if (!log || stats.failed === 0) return;
  const unexpected = Object.keys(errorCodes).filter((code) => !INVALID_TOKEN_ERRORS.has(code));
  if (unexpected.length === 0 && failedBatches === 0) return;
  const allFailed = stats.sent === 0 && stats.failed > 0;
  const credentials = allFailed && unexpected.some((code) => CREDENTIAL_ERRORS.has(code));
  const fields = { ...context, tokens: stats.tokens, sent: stats.sent, failed: stats.failed, removed: stats.removed, failedBatches, errorCodes };
  try {
    if (credentials) log.error("push send failed: FCM/APNs credentials rejected", fields);
    else if (allFailed) log.error("push send failed: every token failed", fields);
    else log.warn("push send partially failed", fields);
  } catch { /* logging must not break delivery */ }
}

/** Resolves the users' tokens and sends. Users without tokens are skipped silently. */
export async function sendPush(deps: Pick<PushDependencies, "messaging" | "devices"> & { logger?: DeliveryLog }, uids: readonly string[], message: PushMessage): Promise<PushStats> {
  const unique = [...new Set(uids)];
  if (unique.length === 0) return { recipients: 0, tokens: 0, sent: 0, failed: 0, removed: 0 };
  const stats = await sendToDevices(deps, await deps.devices.tokensFor(unique), message);
  return { ...stats, recipients: unique.length };
}
