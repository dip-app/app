import { type ImportField, type ImportRow, IMPORT_FIELDS, IMPORT_LIMITS, type Role } from "./adminTypes";
import { FIELD_LABEL, type ParsedImport, validateRow } from "./importFile";
import type { KeyValueStore } from "./api";

// Column mapping for the bulk import: which spreadsheet column feeds which field we ingest. The browser suggests
// a match from each header, the admin confirms or changes it, and the mapped rows are normalized into ImportRows
// that go to the dry run. A confirmed mapping can be remembered per company (by header name) for the next file.

export type Target = ImportField | "skip";

export const TARGET_LABEL: Record<Target, string> = { ...FIELD_LABEL, skip: "Skip this column" };
export const REQUIRED_FIELDS: readonly ImportField[] = ["email"];

const HEADER_ALIASES: Record<string, ImportField> = {
  email: "email", emailaddress: "email", workemail: "email", mail: "email", emailid: "email", companyemail: "email",
  displayname: "displayName", name: "displayName", fullname: "displayName", employeename: "displayName", employee: "displayName",
  role: "role", accessrole: "role",
  team: "teams", teams: "teams", teamnames: "teams", squad: "teams", group: "teams", groups: "teams",
  department: "department", dept: "department", division: "department", businessunit: "department",
  jobtitle: "jobTitle", title: "jobTitle", position: "jobTitle", jobposition: "jobTitle",
  worklocation: "workLocation", location: "workLocation", office: "workLocation", site: "workLocation", city: "workLocation",
  manageremail: "managerEmail", manager: "managerEmail", managersemail: "managerEmail", reportsto: "managerEmail", supervisor: "managerEmail",
  startdate: "startDate", start: "startDate", hiredate: "startDate", datehired: "startDate", joindate: "startDate", datejoined: "startDate",
};

export const normHeader = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");
/** Key for remembering a header: its trimmed lower-case text, so non-Latin headers are kept too. */
const headerKey = (value: string) => value.trim().toLowerCase();

/** The best guess for one header; the first column that claims a field wins in `suggestMapping`. */
export function suggestTarget(header: string): Target {
  return HEADER_ALIASES[normHeader(header)] ?? "skip";
}

/** A suggestion per column; a field is suggested at most once (later duplicates are skipped). */
export function suggestMapping(headers: string[]): Target[] {
  const used = new Set<Target>();
  return headers.map((header) => {
    const guess = suggestTarget(header);
    if (guess === "skip" || used.has(guess)) return "skip";
    used.add(guess);
    return guess;
  });
}

export interface MappingIssues { errors: string[]; warnings: string[] }

export function mappingIssues(mapping: Target[]): MappingIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!mapping.includes(field)) errors.push(`Choose which column holds ${FIELD_LABEL[field].toLowerCase()}. It is required.`);
  }
  for (const field of IMPORT_FIELDS) {
    if (mapping.filter((target) => target === field).length > 1) errors.push(`${FIELD_LABEL[field]} is mapped to more than one column. Pick one and skip the others.`);
  }
  if (!mapping.includes("displayName")) warnings.push("No name column: people who aren’t in DIP yet can’t be added without one (people already in DIP are fine).");
  return { errors, warnings };
}

/** The row that looks most like a header: the most recognised column names among the first ten rows, else the first row with several cells. */
export function guessHeaderRow(rows: string[][]): number {
  let best = -1;
  let bestScore = 0;
  rows.slice(0, 10).forEach((row, i) => {
    const score = row.filter((cell) => suggestTarget(cell) !== "skip").length;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  if (best >= 0) return best;
  const wide = rows.findIndex((row) => row.filter((cell) => cell.trim() !== "").length >= 2);
  if (wide >= 0) return wide;
  const first = rows.findIndex((row) => row.some((cell) => cell.trim() !== ""));
  return first < 0 ? 0 : first;
}

const rowIsEmpty = (cells: string[]) => cells.every((cell) => (cell ?? "").trim() === "");

/** The data rows under the header row, as spreadsheet lines (1-based, as Excel shows them). */
export function dataRowsOf(rows: string[][], headerRow: number): { cells: string[]; line: number }[] {
  return rows.slice(headerRow + 1).map((cells, i) => ({ cells, line: headerRow + i + 2 })).filter((item) => !rowIsEmpty(item.cells));
}

/** Turns one spreadsheet row into a normalized ImportRow under a mapping. */
export function mapRow(cells: string[], mapping: Target[]): ImportRow {
  const get = (field: ImportField) => {
    const column = mapping.indexOf(field);
    return column < 0 ? "" : (cells[column] ?? "").trim();
  };
  return {
    email: get("email").toLowerCase(), displayName: get("displayName"), role: get("role").toLowerCase() as Role | "",
    teams: get("teams").split(/[;|]/).map((team) => team.trim()).filter(Boolean),
    department: get("department"), jobTitle: get("jobTitle"), workLocation: get("workLocation"),
    managerEmail: get("managerEmail").toLowerCase(), startDate: get("startDate"),
  };
}

/** Maps every data row, runs the browser-side checks and flags duplicates; the server re-validates everything. */
export function applyMapping(rows: string[][], headerRow: number, mapping: Target[], domain: string): ParsedImport {
  const headers = rows[headerRow] ?? [];
  const unknownColumns = headers.filter((_, i) => mapping[i] === "skip" || mapping[i] === undefined).map((cell) => cell.trim()).filter(Boolean);
  const empty: ParsedImport = { rows: [], lines: [], localErrors: new Map(), unknownColumns };
  const issues = mappingIssues(mapping);
  if (issues.errors.length) return { ...empty, fatal: issues.errors[0] };
  const data = dataRowsOf(rows, headerRow);
  if (data.length === 0) return { ...empty, fatal: "There are no rows under the header row." };
  if (data.length > IMPORT_LIMITS.maxRows) return { ...empty, fatal: `Files are limited to ${IMPORT_LIMITS.maxRows} rows; this one has ${data.length}. Split it and import in parts.` };
  const mapped: ImportRow[] = [];
  const lines: number[] = [];
  const localErrors = new Map<number, string[]>();
  const seen = new Map<string, number>();
  for (const { cells, line } of data) {
    const row = mapRow(cells, mapping);
    const errors = validateRow(row, domain);
    const first = seen.get(row.email);
    if (row.email && first !== undefined) errors.push(`Duplicate of line ${first}.`);
    else if (row.email) seen.set(row.email, line);
    mapped.push(row);
    lines.push(line);
    if (errors.length) localErrors.set(line, errors);
  }
  return { rows: mapped, lines, localErrors, unknownColumns };
}

/** Header row 0 with suggested columns: what a file that follows the template gets without a mapping step. */
export function rowsFromTable(table: string[][], domain: string): ParsedImport {
  if (table.length === 0) return { rows: [], lines: [], localErrors: new Map(), unknownColumns: [], fatal: "The file is empty." };
  const headerRow = guessHeaderRow(table);
  return applyMapping(table, headerRow, suggestMapping(table[headerRow] ?? []), domain);
}

// ---------- Saved mapping (per company, by header name)

export interface SavedMapping { byHeader: Record<string, Target>; savedAt: string }
const keyOf = (companyId: string) => `dip-admin-import-mapping-v1:${companyId}`;

export function loadSavedMapping(store: KeyValueStore, companyId: string): SavedMapping | null {
  try {
    const raw = store.getItem(keyOf(companyId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedMapping;
    return saved && typeof saved.byHeader === "object" ? saved : null;
  } catch {
    return null;
  }
}

export function saveMapping(store: KeyValueStore, companyId: string, headers: string[], mapping: Target[], now: Date = new Date()): void {
  const byHeader: Record<string, Target> = {};
  headers.forEach((header, i) => {
    const key = headerKey(header);
    if (key) byHeader[key] = mapping[i] ?? "skip";
  });
  try {
    store.setItem(keyOf(companyId), JSON.stringify({ byHeader, savedAt: now.toISOString() } satisfies SavedMapping));
  } catch {
    // Storage can be unavailable (private window); the mapping just isn't remembered.
  }
}

export function forgetMapping(store: KeyValueStore, companyId: string): void {
  try { store.removeItem(keyOf(companyId)); } catch { /* nothing to forget */ }
}

/**
 * A saved mapping applies when it knows the file's headers: every saved header that appears keeps its target and
 * the email column is found. Headers the mapping has never seen fall back to the suggestion. Returns null when
 * the saved mapping doesn't recognise enough of this file.
 */
export function mappingFromSaved(headers: string[], saved: SavedMapping): Target[] | null {
  const known = headers.filter((header) => headerKey(header) in saved.byHeader);
  if (known.length === 0 || known.length < headers.filter((header) => headerKey(header)).length / 2) return null;
  const suggested = suggestMapping(headers);
  const used = new Set<Target>();
  const mapping = headers.map((header, column): Target => {
    const key = headerKey(header);
    const target = key in saved.byHeader ? saved.byHeader[key] : suggested[column];
    if (target === "skip" || used.has(target)) return "skip";
    used.add(target);
    return target;
  });
  return mapping.includes("email") ? mapping : null;
}

export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}
