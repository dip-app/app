// Dependency-free CSV reading and writing (RFC 4180: quoted fields, doubled quotes, CRLF or LF, BOM).

/** Parses CSV text into rows of cells. Blank lines are skipped. Delimiter is detected (comma or semicolon). */
export function parseCsv(input: string, keepBlank = false): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (keepBlank || row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n") endRow();
    else if (char === "\r") { if (text[i + 1] === "\n") i += 1; endRow(); }
    else cell += char;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Cells starting with = + - @ are executed as formulas by spreadsheet apps; prefix them with a quote so
 * exported names and reasons cannot inject formulas.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(rows: (string | number)[][]): string {
  const cell = (value: string | number) => {
    const text = neutralizeFormula(String(value));
    return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** Saves text as a file download (the browser keeps it local; nothing is uploaded). */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
