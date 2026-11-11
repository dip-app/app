import type { FinalizeEventPhotoRequest } from "../../../generated/models";
import { PhotoError } from "./errors";

/**
 * Album upload policy (V2-05). Mirrored by gcp/storage.rules, which enforces the same size, type,
 * slot and eligibility limits on the upload itself; this module re-verifies everything server-side.
 *
 * - Who may upload: a verified Google member whose server-written RSVP for the event is `going`
 *   (which also proves same-company membership), after the event has ended, while it is `scheduled`.
 *   Attendance (`checkedIn`) is not required: no attendance command is live yet.
 * - Limits: at most PHOTO_SLOTS objects per member per event (one create-only Storage object per slot),
 *   each 1 byte..10 MiB, `image/jpeg`, `image/png` or `image/heic` with matching file signature.
 */
export const PHOTO_SLOTS = 20;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_CAPTION_LENGTH = 280;
export const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/heic"] as const;
export type PhotoContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

// An opaque wire ID: one Firestore document segment of safe characters.
export function validWireId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value) &&
    !/^__.*__$/.test(value);
}

/** The only Storage object path a member may finalize for a slot. */
export function photoStoragePath(companyId: string, eventId: string, uid: string, slot: number): string {
  return `companies/${companyId}/events/${eventId}/photos/${uid}/${slot}`;
}

/** Deterministic album document ID for a member's slot: retries and replays address the same document. */
export function photoDocumentId(uid: string, slot: number): string {
  return `${uid}_${slot}`;
}

export interface ParsedFinalizeRequest {
  companyId: string;
  eventId: string;
  photoId: string;
  storagePath: string;
  caption: string;
  slot: number;
}

const KEYS = ["contractVersion", "companyId", "eventId", "photoId", "storagePath", "caption"];

/**
 * Strict request validation; the slot is derived from photoId, which must belong to the caller.
 * A photoId or path naming another member, event or company fails VALIDATION_FAILED before any read.
 */
export function parseFinalizeRequest(data: unknown, uid: string): ParsedFinalizeRequest {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new PhotoError("invalid-argument", "VALIDATION_FAILED", "Invalid request.");
  }
  const record = data as Record<string, unknown>;
  const fields = Object.keys(record).filter(key => !KEYS.includes(key));
  if (record.contractVersion !== 1) fields.push("contractVersion");
  if (!validWireId(record.companyId)) fields.push("companyId");
  if (!validWireId(record.eventId)) fields.push("eventId");
  const caption = record.caption === undefined ? "" : record.caption;
  if (typeof caption !== "string" || caption.trim() !== caption || [...caption].length > MAX_CAPTION_LENGTH) fields.push("caption");
  let slot = -1;
  const photoId = record.photoId;
  const prefix = `${uid}_`;
  if (typeof photoId === "string" && photoId.startsWith(prefix) && /^(1?[0-9])$/.test(photoId.slice(prefix.length))) {
    slot = Number(photoId.slice(prefix.length));
  }
  if (slot < 0 || slot >= PHOTO_SLOTS) fields.push("photoId");
  if (fields.length) throw new PhotoError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", [...new Set(fields)].sort());
  const request = record as unknown as FinalizeEventPhotoRequest;
  if (request.storagePath !== photoStoragePath(request.companyId, request.eventId, uid, slot)) {
    throw new PhotoError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", ["storagePath"]);
  }
  return { companyId: request.companyId, eventId: request.eventId, photoId: request.photoId,
    storagePath: request.storagePath, caption: caption as string, slot };
}

/** Image type from the first bytes of the object, or null when it is not an accepted image. */
export function sniffImageType(head: Uint8Array): PhotoContentType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length >= 8 && png.every((byte, index) => head[index] === byte)) return "image/png";
  if (head.length >= 12) {
    const box = String.fromCharCode(...head.slice(4, 8));
    const brand = String.fromCharCode(...head.slice(8, 12));
    if (box === "ftyp" && ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

export interface StoredObject {
  size: number;
  contentType: string | null;
  head: Uint8Array;
}

/** Validates the uploaded object; returns its verified type. */
export function validateUpload(object: StoredObject): PhotoContentType {
  const declared = ALLOWED_CONTENT_TYPES.find(type => type === object.contentType);
  const sniffed = sniffImageType(object.head);
  if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > MAX_PHOTO_BYTES || !declared || sniffed !== declared) {
    throw new PhotoError("failed-precondition", "UPLOAD_INVALID", "The uploaded file is not an accepted photo.");
  }
  return declared;
}
