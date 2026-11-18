import { z } from "zod";
import type { CompanyOffice, SetCompanyOfficeResponse } from "../../../generated/models";
import { authorize, requireCaller, writeAudit } from "../../admin/application/context";
import type { AdminStore, Caller, RateLimiter } from "../../admin/application/ports";
import { change } from "../../admin/domain/audit";
import { AdminError, invalid } from "../../admin/domain/errors";
import { paths } from "../../admin/domain/ops";
import type { AiLog } from "../../ai/application/ports";
import { fieldsOf } from "../../ai/domain/request";
import { officeOf } from "../domain/office";
import type { LocationProvider } from "./ports";
import { consumePlacesQuota, DEFAULT_PLACES_DAILY_LIMIT, placesErrorCode, placesUnavailable } from "./quota";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

/** Strict schema of setCompanyOfficeV1 (contract SetCompanyOfficeRequest): the client sends the picked place, the server resolves it. */
export const SetCompanyOfficeRequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(ID_PATTERN),
  placeId: z.string().regex(PLACE_ID_PATTERN),
  sessionToken: z.string().min(1).max(128).optional(),
});

export interface SetCompanyOfficeDeps {
  store: AdminStore;
  places: LocationProvider | null;
  enabled: boolean;
  dailyLimit?: number;
  limiter?: RateLimiter;
  log?: AiLog;
  now: () => Date;
  newId: () => string;
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * setCompanyOfficeV1: company.manage (admin). The client sends only the picked `placeId` (and the autocomplete session token);
 * the server resolves it with Place Details Essentials, so coordinates can never be forged by a client, and writes
 * `officeAddress` (street line), `city`, `officeLatitude`, `officeLongitude`, `officePlaceId` and `officeLocationAt` on the caller's
 * own company through the Admin SDK. 0/0 is rejected. The daily refresh job keeps the coordinates inside Google's 30-day caching
 * limit. The audit entry records that the office changed and the city, never the street address or the coordinates.
 */
export async function setCompanyOffice(deps: SetCompanyOfficeDeps, rawCaller: Caller | null, data: unknown): Promise<SetCompanyOfficeResponse> {
  const caller = requireCaller(rawCaller);
  const parsed = SetCompanyOfficeRequestSchema.safeParse(data);
  if (!parsed.success) throw invalid(fieldsOf(parsed.error));
  const { companyId, placeId, sessionToken } = parsed.data;
  await deps.store.runReadOnly(tx => authorize(tx, caller, companyId, "company.manage"));
  await deps.limiter?.consume(caller.uid);
  if (!deps.enabled || !deps.places) throw new AdminError("failed-precondition", "PLACES_DISABLED", "Place search is not available right now.");
  await consumePlacesQuota(deps.store, companyId, deps.now(), deps.dailyLimit ?? DEFAULT_PLACES_DAILY_LIMIT);
  let place;
  try {
    place = await deps.places.details(placeId, { tier: "essentials", sessionToken });
  } catch (error) {
    deps.log?.("places.setOffice", { companyId, outcome: `places_${placesErrorCode(error)}` }, "warn");
    throw placesUnavailable();
  }
  if (!place) throw new AdminError("not-found", "PLACE_NOT_FOUND", "That place could not be found. Pick a suggestion.");
  const latitude = round6(place.latitude);
  const longitude = round6(place.longitude);
  if ((latitude === 0 && longitude === 0) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw invalid(["placeId"]);
  const address = (place.address || place.locality).slice(0, 200);
  const locality = (place.locality || place.address).slice(0, 120);
  if (address === "") throw invalid(["placeId"]);
  const office: CompanyOffice = { address, locality, latitude, longitude };
  const now = deps.now();
  await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, caller, companyId, "company.manage");
    const company = await tx.get(paths.company(companyId));
    if (!company) throw new AdminError("not-found", "COMPANY_NOT_FOUND", "Company not found.");
    const before = officeOf(company);
    tx.update(paths.company(companyId), {
      officeAddress: office.address, city: office.locality, officeLatitude: office.latitude, officeLongitude: office.longitude, officePlaceId: placeId, officeLocationAt: now,
    });
    writeAudit(tx, actor, {
      id: `${actor.uid}_office_${deps.newId()}`, action: "company.office.update", targetType: "company", targetId: companyId,
      summary: before ? "Changed the office location" : "Set the office location",
      changes: [change("office", before ? "set" : "not set", "set"), change("city", before?.locality ?? null, office.locality)],
    });
  });
  return { contractVersion: 1, office };
}
