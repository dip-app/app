// Minimal XLSX reader: every worksheet as rows of text. An .xlsx is a zip of XML parts; fflate (pinned, small,
// no dependencies) unzips it in the browser and the platform DOMParser reads the XML. Nothing is uploaded.
// Formulas read as their cached value; dates come through as serial numbers, so use text cells.

export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

/** Text of a shared string or inline cell; phonetic runs (rPh) are furigana, not the value. */
function textOf(node: Element): string {
  return Array.from(node.getElementsByTagName("t")).filter((t) => t.parentElement?.tagName !== "rPh").map((t) => t.textContent ?? "").join("");
}

export interface XlsxSheet { name: string; rows: string[][] }

/**
 * Reads every worksheet of a workbook (name and rows). Row positions are kept: an empty spreadsheet row stays an
 * empty array, so row numbers match what Excel shows.
 */
export async function readXlsxWorkbook(buffer: ArrayBuffer): Promise<XlsxSheet[]> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(buffer), {
    // Inflate only the parts we read, so a hostile archive can't expand huge media files.
    filter: (file) =>
      /^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels)$/.test(file.name) &&
      file.originalSize < 20_000_000,
  });
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : null);
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  // Sheets in workbook order, each resolved through its relationship; a bare workbook falls back to sheet1.
  const found: { name: string; path: string }[] = [];
  if (workbook && rels) {
    const targets = new Map(Array.from(parseXml(rels).getElementsByTagName("Relationship")).map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));
    for (const sheet of Array.from(parseXml(workbook).getElementsByTagName("sheet"))) {
      const target = targets.get(sheet.getAttribute("r:id"));
      if (target) found.push({ name: sheet.getAttribute("name") ?? `Sheet ${found.length + 1}`, path: target.startsWith("/") ? target.slice(1) : `xl/${target}` });
    }
  }
  if (found.length === 0) found.push({ name: "Sheet 1", path: "xl/worksheets/sheet1.xml" });
  const shared = read("xl/sharedStrings.xml");
  const strings = shared ? Array.from(parseXml(shared).getElementsByTagName("si")).map(textOf) : [];

  const sheets: XlsxSheet[] = [];
  for (const { name, path } of found) {
    const xml = read(path);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rowNode of Array.from(parseXml(xml).getElementsByTagName("row"))) {
      const cells: string[] = [];
      for (const cell of Array.from(rowNode.getElementsByTagName("c"))) {
        const type = cell.getAttribute("t");
        const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
        const value = type === "s" ? (strings[Number(raw)] ?? "") : type === "inlineStr" ? textOf(cell) : raw;
        cells[columnIndex(cell.getAttribute("r") ?? "A1")] = value;
      }
      const index = Number(rowNode.getAttribute("r")) - 1;
      rows[Number.isInteger(index) && index >= 0 ? index : rows.length] = Array.from(cells, (value) => value ?? "");
    }
    sheets.push({ name, rows: Array.from(rows, (row) => row ?? []) });
  }
  if (sheets.length === 0) throw new Error("This workbook has no readable sheet.");
  return sheets;
}
