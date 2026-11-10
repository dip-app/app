import { createHash } from "node:crypto";
import { NotificationsError } from "./errors";

/** Upper bound of registered devices per user; the least recently refreshed are evicted first. */
export const MAX_DEVICES_PER_USER = 10;
export const DEVICE_PLATFORMS = ["ios"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

// FCM registration tokens are opaque URL-safe strings (~160 chars today); keep a generous bound.
const TOKEN_PATTERN = /^[A-Za-z0-9_:.-]{20,4096}$/;
const APP_VERSION_PATTERN = /^[A-Za-z0-9._()+ -]{1,32}$/;

export interface RegisterDevice { token: string; platform: DevicePlatform; appVersion: string }
export interface UnregisterDevice { token: string }

/** Document ID of `users/{uid}/devices/{tokenHash}`: lowercase hex SHA-256 of the token. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function fail(fields: string[]): never {
  throw new NotificationsError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", fields.sort());
}

function record(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail(["request"]);
  return data as Record<string, unknown>;
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

export function parseRegisterDevice(data: unknown): RegisterDevice {
  const value = record(data);
  const fields = unknownKeys(value, ["contractVersion", "token", "platform", "appVersion"]);
  if (value.contractVersion !== 1) fields.push("contractVersion");
  if (typeof value.token !== "string" || !TOKEN_PATTERN.test(value.token)) fields.push("token");
  if (!(DEVICE_PLATFORMS as readonly unknown[]).includes(value.platform)) fields.push("platform");
  if (typeof value.appVersion !== "string" || !APP_VERSION_PATTERN.test(value.appVersion)) fields.push("appVersion");
  if (fields.length) fail(fields);
  return { token: value.token as string, platform: value.platform as DevicePlatform, appVersion: value.appVersion as string };
}

export function parseUnregisterDevice(data: unknown): UnregisterDevice {
  const value = record(data);
  const fields = unknownKeys(value, ["contractVersion", "token"]);
  if (value.contractVersion !== 1) fields.push("contractVersion");
  if (typeof value.token !== "string" || !TOKEN_PATTERN.test(value.token)) fields.push("token");
  if (fields.length) fail(fields);
  return { token: value.token as string };
}
