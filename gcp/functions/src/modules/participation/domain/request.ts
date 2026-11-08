import type { SetRsvpRequest } from "../../../generated/models";
import { ParticipationError } from "./errors";

// An opaque ID is exactly one Firestore document segment, never a path.
export function validDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    Buffer.byteLength(value, "utf8") <= 1500 && !/[\/\x00-\x1f\x7f]/.test(value) &&
    value !== "." && value !== ".." && !/^__.*__$/.test(value);
}

// Contract v1 IDs are narrower than arbitrary Firestore/Auth document IDs.
function validWireId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value) && validDocumentId(value);
}

export function parseRequest(data: unknown): SetRsvpRequest {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ParticipationError("invalid-argument", "VALIDATION_FAILED", "Invalid request.");
  }
  const record = data as Record<string, unknown>;
  const fields = Object.keys(record).filter(key => !["contractVersion", "companyId", "eventId", "status"].includes(key));
  if (record.contractVersion !== 1) fields.push("contractVersion");
  if (!validWireId(record.companyId)) fields.push("companyId");
  if (!validWireId(record.eventId)) fields.push("eventId");
  if (record.status !== "going" && record.status !== "cancelled") fields.push("status");
  if (fields.length) throw new ParticipationError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", fields.sort());
  return record as unknown as SetRsvpRequest;
}
