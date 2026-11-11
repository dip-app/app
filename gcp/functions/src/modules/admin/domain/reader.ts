import { createHash } from "node:crypto";
import { invalid } from "./errors";

/** An opaque wire ID: one Firestore document segment of safe characters (contract v1). */
export function validWireId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value) && !/^__.*__$/.test(value);
}

export const validRequestId = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);

export const length = (value: string) => [...value].length;

/**
 * Strict, collecting request reader: unknown keys, a wrong contractVersion and every malformed field
 * are gathered and reported together as VALIDATION_FAILED with sorted `fields`.
 */
export class Reader {
  private readonly bad = new Set<string>();
  private constructor(readonly record: Record<string, unknown>) {}

  static from(data: unknown, allowed: readonly string[]): Reader {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw invalid();
    const record = data as Record<string, unknown>;
    const reader = new Reader(record);
    for (const key of Object.keys(record)) if (!allowed.includes(key)) reader.bad.add(key);
    if (record.contractVersion !== 1) reader.bad.add("contractVersion");
    return reader;
  }

  private has(key: string) { return this.record[key] !== undefined; }
  fail(key: string) { this.bad.add(key); }

  id(key: string): string {
    const value = this.record[key];
    if (!validWireId(value)) { this.bad.add(key); return ""; }
    return value;
  }

  optId(key: string): string | undefined {
    return this.has(key) ? this.id(key) : undefined;
  }

  requestId(): string {
    const value = this.record.requestId;
    if (!validRequestId(value)) { this.bad.add("requestId"); return ""; }
    return value;
  }

  /** Required string that is already trimmed with min..max code points. */
  text(key: string, max: number, min = 0): string {
    const value = this.record[key];
    if (typeof value !== "string" || value.trim() !== value || length(value) < min || length(value) > max) {
      this.bad.add(key);
      return "";
    }
    return value;
  }

  optText(key: string, max: number, min = 0): string | undefined {
    return this.has(key) ? this.text(key, max, min) : undefined;
  }

  enum<T extends string>(key: string, values: readonly T[]): T {
    const value = this.record[key];
    if (typeof value !== "string" || !(values as readonly string[]).includes(value)) { this.bad.add(key); return values[0] as T; }
    return value as T;
  }

  optEnum<T extends string>(key: string, values: readonly T[]): T | undefined {
    return this.has(key) ? this.enum(key, values) : undefined;
  }

  optBool(key: string): boolean | undefined {
    if (!this.has(key)) return undefined;
    const value = this.record[key];
    if (typeof value !== "boolean") { this.bad.add(key); return undefined; }
    return value;
  }

  int(key: string, min: number, max: number): number {
    const value = this.record[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) { this.bad.add(key); return min; }
    return value;
  }

  optInt(key: string, min: number, max: number): number | undefined {
    return this.has(key) ? this.int(key, min, max) : undefined;
  }

  /** Array of wire IDs, deduplicated while keeping order. */
  idList(key: string, maxItems: number): string[] | undefined {
    if (!this.has(key)) return undefined;
    const value = this.record[key];
    if (!Array.isArray(value) || value.length > maxItems || !value.every(validWireId)) { this.bad.add(key); return undefined; }
    return [...new Set(value as string[])];
  }

  finish(): void {
    if (this.bad.size > 0) throw invalid([...this.bad]);
  }
}

/** Deterministic JSON (sorted keys) for idempotency hashes. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(k => record[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableJson(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export const payloadHash = (payload: unknown) => sha256(stableJson(payload));
