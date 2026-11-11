import { type ImportField, type ImportRow, IMPORT_FIELDS, IMPORT_LIMITS, type PlanRow, type Role } from "./adminTypes";
import { parseCsv, toCsv } from "./csv";

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

const ROLES: Role[] = ["member", "organizer", "admin"];

/** Local, field-level checks that spare a round trip; the server re-validates everything. */
export function validateRow(row: ImportRow, domain: string): string[] {
  const errors: string[] = [];
  const email = row.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email isn’t valid.");
  else if (domain && !(email.endsWith(`@${domain}`) || email.endsWith(`.${domain}`))) errors.push(`Email must end in @${domain}.`);
  if (row.managerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.managerEmail)) errors.push("Manager email isn’t valid.");
  if (row.displayName.length > 80) errors.push("Name is longer than 80 characters.");
  if (row.role !== "" && !ROLES.includes(row.role)) errors.push("Role must be member, organizer or admin.");
  if (row.startDate && (!/^\d{4}-\d{2}-\d{2}$/.test(row.startDate) || Number.isNaN(Date.parse(row.startDate)))) errors.push("Start date must look like 2026-01-31.");
  for (const [field, max] of [["department", 120], ["jobTitle", 120], ["workLocation", 120]] as const) {
    if (row[field].length > max) errors.push(`${FIELD_LABEL[field]} is longer than ${max} characters.`);
  }
  return errors;
}

export interface RawFile {
  fileName: string;
  /** CSV files have one sheet; workbooks have one entry per tab. Row positions match the spreadsheet (row 1 = index 0). */
  sheets: { name: string; rows: string[][] }[];
  fatal?: string;
}

/** Reads the file into raw rows without interpreting columns; the mapping step does that. */
export async function readRawFile(file: File): Promise<RawFile> {
  const base: RawFile = { fileName: file.name, sheets: [] };
  if (file.size > IMPORT_LIMITS.maxBytes) return { ...base, fatal: `Files are limited to ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB.` };
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".xlsx")) {
      const { readXlsxWorkbook } = await import("./xlsx");
      const sheets = (await readXlsxWorkbook(await file.arrayBuffer())).filter((sheet) => sheet.rows.some((row) => row.some((cell) => cell.trim() !== "")));
      return sheets.length ? { ...base, sheets } : { ...base, fatal: "The workbook is empty." };
    }
    if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv") {
      const rows = parseCsv(await file.text());
      return rows.length ? { ...base, sheets: [{ name: "CSV", rows }] } : { ...base, fatal: "The file is empty." };
    }
    return { ...base, fatal: "Upload a .csv or .xlsx file." };
  } catch {
    return { ...base, fatal: "That file couldn’t be read. Save it as .csv or .xlsx and try again." };
  }
}

/** The rows worth sending to the server (the browser already rejected the rest), with their spreadsheet lines. */
export function validRows(parsed: ParsedImport): { rows: ImportRow[]; lines: number[] } {
  const rows: ImportRow[] = [];
  const lines: number[] = [];
  parsed.rows.forEach((row, i) => {
    if (parsed.localErrors.has(parsed.lines[i])) return;
    rows.push(row);
    lines.push(parsed.lines[i]);
  });
  return { rows, lines };
}

export function errorCsv(rows: { line: number; email: string; errors: string[] }[]): string {
  return toCsv([["line", "email", "problem"], ...rows.map((r) => [r.line, r.email, r.errors.join(" ")])]);
}

export function planCounts(rows: PlanRow[]): Record<PlanRow["action"], number> {
  const counts = { create: 0, update: 0, unchanged: 0, invalid: 0 };
  for (const row of rows) counts[row.action] += 1;
  return counts;
}
