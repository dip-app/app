// Minimal XLSX reader: the first worksheet as rows of text. An .xlsx is a zip of XML parts; fflate (pinned,
// small, no dependencies) unzips it in the browser and the platform DOMParser reads the XML. Nothing is
// uploaded. Formulas read as their cached value; dates come through as serial numbers, so use text cells.

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

export async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(buffer), {
    // Inflate only the parts we read, so a hostile archive can't expand huge media files.
    filter: (file) =>
      /^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels)$/.test(file.name) &&
      file.originalSize < 20_000_000,
  });
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : null);
  // The first sheet in workbook order, via its relationship; falls back to sheet1.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  if (workbook && rels) {
    const rid = parseXml(workbook).getElementsByTagName("sheet")[0]?.getAttribute("r:id");
    const target = Array.from(parseXml(rels).getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === rid)?.getAttribute("Target");
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  }
  const sheet = read(sheetPath);
  if (!sheet) throw new Error("This workbook has no readable sheet.");
  const shared = read("xl/sharedStrings.xml");
  const strings = shared ? Array.from(parseXml(shared).getElementsByTagName("si")).map(textOf) : [];

  const rows: string[][] = [];
  for (const rowNode of Array.from(parseXml(sheet).getElementsByTagName("row"))) {
    const cells: string[] = [];
    for (const cell of Array.from(rowNode.getElementsByTagName("c"))) {
      const type = cell.getAttribute("t");
      const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      const value = type === "s" ? (strings[Number(raw)] ?? "") : type === "inlineStr" ? textOf(cell) : raw;
      cells[columnIndex(cell.getAttribute("r") ?? "A1")] = value;
    }
    const filled = Array.from(cells, (value) => value ?? "");
    if (filled.some((value) => value.trim() !== "")) rows.push(filled);
  }
  return rows;
}
