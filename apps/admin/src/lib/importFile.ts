import { type ImportField, type ImportRow, IMPORT_FIELDS, IMPORT_LIMITS, type PlanRow, type Role } from "./adminTypes";
import { parseCsv, toCsv } from "./csv";

const HEADER_ALIASES: Record<string, ImportField> = {
  email: "email", emailaddress: "email", workemail: "email",
  displayname: "displayName", name: "displayName", fullname: "displayName",
  role: "role", accessrole: "role",
  team: "teams", teams: "teams", teamnames: "teams",
  department: "department", dept: "department",
  jobtitle: "jobTitle", title: "jobTitle", position: "jobTitle",
  worklocation: "workLocation", location: "workLocation", office: "workLocation",
  manageremail: "managerEmail", manager: "managerEmail",
  startdate: "startDate", start: "startDate", hiredate: "startDate",
};

export const FIELD_LABEL: Record<ImportField, string> = {
  email: "Email", displayName: "Name", role: "Role", teams: "Teams", department: "Department",
  jobTitle: "Job title", workLocation: "Work location", managerEmail: "Manager email", startDate: "Start date",
};

export const TEMPLATE_HEADER: string[] = [...IMPORT_FIELDS];
const TEMPLATE_EXAMPLE = ["sam.rivera@example.com", "Sam Rivera", "member", "Platform;Mentors", "Engineering", "Software engineer", "Pittsburgh", "lee.chen@example.com", "2026-01-12"];

export function templateCsv(domain: string): string {
  const example = [...TEMPLATE_EXAMPLE];
  example[0] = `sam.rivera@${domain || "example.com"}`;
  example[7] = `lee.chen@${domain || "example.com"}`;
  return toCsv([TEMPLATE_HEADER, example]);
}

export interface ParsedImport {
  rows: ImportRow[];
  /** Spreadsheet line (header = 1) of each row. */
  lines: number[];
  /** Rows the browser already knows are invalid (never sent to the server). */
  localErrors: Map<number, string[]>;
  unknownColumns: string[];
  fatal?: string;
}

const norm = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");
const ROLES: Role[] = ["member", "organizer", "admin"];

/** Local, field-level checks that spare a round trip; the server re-validates everything. */
export function validateRow(row: ImportRow, domain: string): string[] {
  const errors: string[] = [];
  const email = row.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email isn’t valid.");
  else if (domain && !email.endsWith(`@${domain}`)) errors.push(`Email must end in @${domain}.`);
  if (row.managerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.managerEmail)) errors.push("Manager email isn’t valid.");
  if (row.displayName.length > 120) errors.push("Name is longer than 120 characters.");
  if (row.role !== "" && !ROLES.includes(row.role)) errors.push("Role must be member, organizer or admin.");
  if (row.startDate && (!/^\d{4}-\d{2}-\d{2}$/.test(row.startDate) || Number.isNaN(Date.parse(row.startDate)))) errors.push("Start date must look like 2026-01-31.");
  for (const [field, max] of [["department", 80], ["jobTitle", 80], ["workLocation", 80]] as const) {
    if (row[field].length > max) errors.push(`${FIELD_LABEL[field]} is longer than ${max} characters.`);
  }
  return errors;
}

/** Turns the cells of a CSV or the first XLSX sheet into import rows and flags duplicates and bad rows. */
export function rowsFromTable(table: string[][], domain: string): ParsedImport {
  const empty: ParsedImport = { rows: [], lines: [], localErrors: new Map(), unknownColumns: [] };
  if (table.length === 0) return { ...empty, fatal: "The file is empty." };
  const header = table[0].map((cell) => HEADER_ALIASES[norm(cell)]);
  const unknownColumns = table[0].filter((_, index) => !header[index]).map((cell) => cell.trim()).filter(Boolean);
  if (!header.includes("email")) return { ...empty, unknownColumns, fatal: "There is no Email column. Use the template’s header row." };
  const dataRows = table.slice(1);
  if (dataRows.length === 0) return { ...empty, unknownColumns, fatal: "The file has a header but no rows." };
  if (dataRows.length > IMPORT_LIMITS.maxRows) return { ...empty, unknownColumns, fatal: `Files are limited to ${IMPORT_LIMITS.maxRows} rows; this one has ${dataRows.length}. Split it and import in parts.` };

  const rows: ImportRow[] = [];
  const lines: number[] = [];
  const localErrors = new Map<number, string[]>();
  const seen = new Map<string, number>();
  dataRows.forEach((cells, index) => {
    const line = index + 2;
    const get = (field: ImportField) => (cells[header.indexOf(field)] ?? "").trim();
    const role = get("role").toLowerCase() as Role | "";
    const row: ImportRow = {
      email: get("email").toLowerCase(), displayName: get("displayName"), role,
      teams: get("teams").split(/[;|]/).map((team) => team.trim()).filter(Boolean),
      department: get("department"), jobTitle: get("jobTitle"), workLocation: get("workLocation"),
      managerEmail: get("managerEmail").toLowerCase(), startDate: get("startDate"),
    };
    const errors = validateRow(row, domain);
    const first = seen.get(row.email);
    if (row.email && first !== undefined) errors.push(`Duplicate of line ${first}.`);
    else if (row.email) seen.set(row.email, line);
    rows.push(row);
    lines.push(line);
    if (errors.length) localErrors.set(line, errors);
  });
  return { rows, lines, localErrors, unknownColumns };
}

export async function readImportFile(file: File, domain: string): Promise<ParsedImport> {
  const base: ParsedImport = { rows: [], lines: [], localErrors: new Map(), unknownColumns: [] };
  if (file.size > IMPORT_LIMITS.maxBytes) return { ...base, fatal: `Files are limited to ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB.` };
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".xlsx")) {
      const { readXlsx } = await import("./xlsx");
      return rowsFromTable(await readXlsx(await file.arrayBuffer()), domain);
    }
    if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv") return rowsFromTable(parseCsv(await file.text()), domain);
    return { ...base, fatal: "Upload a .csv or .xlsx file." };
  } catch {
    return { ...base, fatal: "That file couldn’t be read. Save it as .csv or .xlsx and try again." };
  }
}

export interface Chunk { chunkIndex: number; firstLine: number; rows: ImportRow[]; lines: number[] }

/** Splits the valid rows into server-sized chunks, keeping each row's spreadsheet line. */
export function chunkRows(parsed: ParsedImport, size: number = IMPORT_LIMITS.chunkSize): Chunk[] {
  const valid = parsed.rows.map((row, i) => ({ row, line: parsed.lines[i] })).filter((item) => !parsed.localErrors.has(item.line));
  const chunks: Chunk[] = [];
  for (let start = 0; start < valid.length; start += size) {
    const part = valid.slice(start, start + size);
    chunks.push({ chunkIndex: chunks.length, firstLine: part[0].line, rows: part.map((p) => p.row), lines: part.map((p) => p.line) });
  }
  return chunks;
}

export function errorCsv(rows: { line: number; email: string; errors: string[] }[]): string {
  return toCsv([["line", "email", "problem"], ...rows.map((r) => [r.line, r.email, r.errors.join(" ")])]);
}

export function planCounts(rows: PlanRow[]): Record<PlanRow["action"], number> {
  const counts = { create: 0, update: 0, unchanged: 0, invalid: 0 };
  for (const row of rows) counts[row.action] += 1;
  return counts;
}
