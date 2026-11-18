import type { CompanyOffice } from "../../../generated/models";
import type { Doc } from "../../admin/application/ports";

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The office from the company document, or null when the coordinates are missing, out of range or 0/0 (not set). */
export function officeOf(company: Doc | null): CompanyOffice | null {
  if (!company) return null;
  const { officeLatitude: latitude, officeLongitude: longitude } = company;
  if (!isNumber(latitude) || !isNumber(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) return null;
  const city = typeof company.city === "string" ? company.city.trim() : "";
  const address = typeof company.officeAddress === "string" && company.officeAddress.trim() !== "" ? company.officeAddress.trim() : city || "Office";
  return { address: address.slice(0, 200), locality: (city || address).slice(0, 120), latitude, longitude };
}
