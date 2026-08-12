import ExcelJS from 'exceljs';
import type { ReportData } from '../modules/reports/reports.service';

// Characters that Excel/Sheets/LibreOffice treat as the start of a formula
// when they're the first character of a cell. Several exported fields
// (fullName, etc.) originate from public, unauthenticated signup input, so a
// crafted name like `=HYPERLINK(...)` could otherwise detonate on whoever
// opens the report. Prefixing with a single quote neutralizes the formula
// while leaving the visible text intact (Excel/Sheets both hide a leading
// apostrophe used this way).
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function neutralizeFormula(str: string): string {
  return FORMULA_TRIGGER.test(str) ? `'${str}` : str;
}

function escapeCsvCell(value: string | number): string {
  const str = neutralizeFormula(String(value));
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsvBuffer(report: ReportData): Buffer {
  const headerLine = report.columns.map((c) => escapeCsvCell(c.header)).join(',');
  const lines = report.rows.map((row) =>
    report.columns.map((c) => escapeCsvCell(row[c.key] ?? '')).join(','),
  );
  return Buffer.from([headerLine, ...lines].join('\n'), 'utf-8');
}

export async function toXlsxBuffer(report: ReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TaskFlow';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Report');
  sheet.columns = report.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
  sheet.getRow(1).font = { bold: true };
  report.rows.forEach((row) => {
    const safeRow: Record<string, unknown> = {};
    for (const c of report.columns) {
      const value = row[c.key];
      safeRow[c.key] = typeof value === 'string' ? neutralizeFormula(value) : value;
    }
    sheet.addRow(safeRow);
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
