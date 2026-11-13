import { strToU8, zipSync } from "fflate";

export type ExcelSheet = {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | boolean | null | undefined>>;
};

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellXml(reference: string, value: ExcelSheet["rows"][number][number]): string {
  if (value === null || value === undefined) return `<c r="${reference}"/>`;
  if (typeof value === "boolean") {
    return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Workbook berisi angka yang tidak valid.");
    return `<c r="${reference}" t="n"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function worksheetXml(sheet: ExcelSheet): string {
  const rows = [sheet.headers, ...sheet.rows];
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => cellXml(`${columnName(columnIndex)}${rowIndex + 1}`, value)).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
}

export function createExcelWorkbook(sheets: ExcelSheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error("Workbook harus memiliki setidaknya satu sheet.");

  const sheetEntries = sheets.map((sheet, index) => {
    const name = sheet.name.trim();
    if (!name || name.length > 31 || /[\\/*?:[\]]/.test(name)) {
      throw new Error(`Nama sheet Excel tidak valid: ${sheet.name}`);
    }
    return { name, index: index + 1 };
  });
  if (new Set(sheetEntries.map(sheet => sheet.name)).size !== sheetEntries.length) {
    throw new Error("Nama sheet Excel tidak boleh duplikat.");
  }

  const workbookSheets = sheetEntries
    .map(sheet => `<sheet name="${escapeXml(sheet.name)}" sheetId="${sheet.index}" r:id="rId${sheet.index}"/>`)
    .join("");
  const relationships = sheetEntries
    .map(sheet => `<Relationship Id="rId${sheet.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheet.index}.xml"/>`)
    .join("");
  const contentTypes = sheetEntries
    .map(sheet => `<Override PartName="/xl/worksheets/sheet${sheet.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${contentTypes}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`)
  };

  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet));
  });
  return zipSync(files, { level: 6 });
}
