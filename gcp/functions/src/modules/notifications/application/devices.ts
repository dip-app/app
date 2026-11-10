import type { RegisterDeviceResponse, UnregisterDeviceResponse } from "../../../generated/models";
import { MAX_DEVICES_PER_USER, parseRegisterDevice, parseUnregisterDevice, tokenHash } from "../domain/device";
import { NotificationsError } from "../domain/errors";
import type { Caller, DeviceRegistry } from "./ports";

function requireGoogleCaller(caller: Caller | null): Caller {
  if (!caller) throw new NotificationsError("unauthenticated", "UNAUTHENTICATED", "Sign in again.");
  if (!caller.emailVerified) throw new NotificationsError("permission-denied", "EMAIL_NOT_VERIFIED", "Verified email required.");
  if (caller.signInProvider !== "google.com") throw new NotificationsError("permission-denied", "PROVIDER_NOT_ALLOWED", "Google sign-in required.");
  return caller;
}

/**
 * registerDeviceV1: idempotent upsert of `users/{uid}/devices/{sha256(token)}` for a company member.
 * In one transaction it (1) removes the same token from any other user (a phone that switched accounts must
 * not receive the previous user's notifications), (2) evicts the least recently refreshed devices beyond
 * MAX_DEVICES_PER_USER and (3) writes the device with a server timestamp. Clients cannot write the registry.
 */
export async function registerDevice(registry: DeviceRegistry, caller: Caller | null, data: unknown): Promise<RegisterDeviceResponse> {
  const authenticated = requireGoogleCaller(caller);
  const request = parseRegisterDevice(data);
  const hash = tokenHash(request.token);
  return registry.runTransaction(async (tx) => {
    const member = await tx.getMember(authenticated.uid);
    if (!member || !member.companyId || (member.role !== "member" && member.role !== "admin")) {
      throw new NotificationsError("permission-denied", "MEMBERSHIP_REQUIRED", "Company membership required.");
    }
    const owners = (await tx.ownersOf(hash)).filter((uid) => uid !== authenticated.uid);
    const devices = await tx.listDevices(authenticated.uid);
    const others = devices.filter((device) => device.tokenHash !== hash)
      .sort((a, b) => (a.updatedAt?.getTime() ?? 0) - (b.updatedAt?.getTime() ?? 0));
    const evict = others.slice(0, Math.max(0, others.length - (MAX_DEVICES_PER_USER - 1)));
    for (const uid of owners) tx.remove(uid, hash);
    for (const device of evict) tx.remove(authenticated.uid, device.tokenHash);
    tx.upsert(authenticated.uid, hash, request);
    return { contractVersion: 1, deviceId: hash };
  });
}

/** unregisterDeviceV1: removes the caller's own registration for this token (sign-out / notifications off). */
export async function unregisterDevice(registry: DeviceRegistry, caller: Caller | null, data: unknown): Promise<UnregisterDeviceResponse> {
  if (!caller) throw new NotificationsError("unauthenticated", "UNAUTHENTICATED", "Sign in again.");
  const request = parseUnregisterDevice(data);
  const hash = tokenHash(request.token);
  return registry.runTransaction(async (tx) => {
    const existed = await tx.exists(caller.uid, hash);
    if (existed) tx.remove(caller.uid, hash);
    return { contractVersion: 1, removed: existed };
  });
}
