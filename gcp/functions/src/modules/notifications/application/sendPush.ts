import type { PushMessage } from "../domain/push";
import type { DeviceToken, PushDependencies } from "./ports";

/** FCM sendEachForMulticast accepts at most 500 tokens per call. */
export const MULTICAST_LIMIT = 500;

/** Tokens FCM will never accept again; their registry documents are deleted. */
export const INVALID_TOKEN_ERRORS: ReadonlySet<string> = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

export interface PushStats { recipients: number; tokens: number; sent: number; failed: number; removed: number }

/**
 * Sends one message to already-resolved devices: dedupes by token, sends in multicast batches of <=500 and
 * removes tokens FCM reports as unregistered/invalid. A failed batch is counted, never retried here (pushes
 * are best-effort, at most once per claim). `recipients` is the number of distinct users among the devices.
 */
export async function sendToDevices(deps: Pick<PushDependencies, "messaging" | "devices">, devices: readonly DeviceToken[], message: PushMessage): Promise<PushStats> {
  // The same token can only be registered under one user, but guard against duplicates anyway.
  const byToken = new Map<string, DeviceToken>();
  for (const device of devices) if (!byToken.has(device.token)) byToken.set(device.token, device);
  const targets = [...byToken.values()];
  const stats: PushStats = { recipients: new Set(targets.map((device) => device.uid)).size, tokens: targets.length, sent: 0, failed: 0, removed: 0 };
  const invalid: DeviceToken[] = [];
  for (let offset = 0; offset < targets.length; offset += MULTICAST_LIMIT) {
    const batch = targets.slice(offset, offset + MULTICAST_LIMIT);
    let results;
    try {
      results = await deps.messaging.sendMulticast(batch.map((device) => device.token), message);
    } catch {
      stats.failed += batch.length;
      continue;
    }
    batch.forEach((device, index) => {
      const result = results[index];
      if (result?.success) { stats.sent++; return; }
      stats.failed++;
      if (result?.errorCode && INVALID_TOKEN_ERRORS.has(result.errorCode)) invalid.push(device);
    });
  }
  if (invalid.length) {
    await deps.devices.remove(invalid);
    stats.removed = invalid.length;
  }
  return stats;
}

/** Resolves the users' tokens and sends. Users without tokens are skipped silently. */
export async function sendPush(deps: Pick<PushDependencies, "messaging" | "devices">, uids: readonly string[], message: PushMessage): Promise<PushStats> {
  const unique = [...new Set(uids)];
  if (unique.length === 0) return { recipients: 0, tokens: 0, sent: 0, failed: 0, removed: 0 };
  const stats = await sendToDevices(deps, await deps.devices.tokensFor(unique), message);
  return { ...stats, recipients: unique.length };
}
