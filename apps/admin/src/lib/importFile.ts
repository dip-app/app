// @i18n-migrated
import { type ImportRow, IMPORT_FIELDS, IMPORT_LIMITS, type PlanRow, type Role } from "./adminTypes";
import { parseCsv, toCsv } from "./csv";
import { hasMessage, t } from "./i18n";

/** The display name of an import field in the current language; an unknown field shows as is. */
export function fieldLabel(field: string): string {
  const key = `import.field.${field}`;
  return hasMessage(key) ? t(key) : field;
}

export const TEMPLATE_HEADER: string[] = [...IMPORT_FIELDS];
const TEMPLATE_EXAMPLE = ["sam.rivera@example.com", "Sam Rivera", "member", "Platform;Mentors", "Engineering", "Software engineer", "Pittsburgh"];

export function templateCsv(domain: string): string {
  const example = [...TEMPLATE_EXAMPLE];
  example[0] = `sam.rivera@${domain || "example.com"}`;
  return toCsv([TEMPLATE_HEADER, example]);
}

export interface ParsedImport {
  rows: ImportRow[];
  /** Spreadsheet row number (as the spreadsheet app shows it) of each row. */
  lines: number[];
  /** Rows the browser already knows are invalid (never sent to the server). */
  localErrors: Map<number, string[]>;
  /** Skipped columns the admin left out (header text). */
  unknownColumns: string[];
  /** Columns of older templates DIP no longer stores (header text): never sent, shown as "not used". */
  retiredColumns?: string[];
  /** Spreadsheet row number of the header row (rows are numbered as the spreadsheet app shows them). */
  headerLine?: number;
  fatal?: string;
}

const ROLES: Role[] = ["member", "organizer", "admin"];

/** Local, field-level checks that spare a round trip; the server re-validates everything. */
export function validateRow(row: ImportRow, domain: string): string[] {
  const errors: string[] = [];
  const email = row.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(t("import.err.email"));
  else if (domain && !(email.endsWith(`@${domain}`) || email.endsWith(`.${domain}`))) errors.push(t("import.err.domain", { domain }));
  if (row.displayName.length > 80) errors.push(t("import.err.name"));
  if (row.role !== "" && !ROLES.includes(row.role)) errors.push(t("import.err.role"));
  for (const [field, max] of [["department", 120], ["jobTitle", 120], ["workLocation", 120]] as const) {
    if (row[field].length > max) errors.push(t("import.err.tooLong", { field: fieldLabel(field), max }));
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
  if (file.size > IMPORT_LIMITS.maxBytes) return { ...base, fatal: t("import.err.fileSize", { mb: IMPORT_LIMITS.maxBytes / 1024 / 1024 }) };
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".xlsx")) {
      const { readXlsxWorkbook } = await import("./xlsx");
      const sheets = (await readXlsxWorkbook(await file.arrayBuffer())).filter((sheet) => sheet.rows.some((row) => row.some((cell) => cell.trim() !== "")));
      return sheets.length ? { ...base, sheets } : { ...base, fatal: t("import.err.workbookEmpty") };
    }
    if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv") {
      // Blank lines are kept so row numbers match the file.
      const rows = parseCsv(await file.text(), true);
      return rows.some((row) => row.some((cell) => cell.trim() !== "")) ? { ...base, sheets: [{ name: "CSV", rows }] } : { ...base, fatal: t("import.err.fileEmpty") };
    }
    return { ...base, fatal: t("import.err.fileType") };
  } catch {
    return { ...base, fatal: t("import.err.unreadable") };
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

/** The downloadable problem list; `row` is the spreadsheet row number, as in the preview. */
export function errorCsv(rows: { line: number; email: string; errors: string[] }[]): string {
  return toCsv([["row", "email", "problem"], ...rows.map((r) => [r.line, r.email, r.errors.join(" ")])]);
}

export function planCounts(rows: PlanRow[]): Record<PlanRow["action"], number> {
  const counts = { create: 0, update: 0, unchanged: 0, invalid: 0 };
  for (const row of rows) counts[row.action] += 1;
  return counts;
}
