import ExcelJS from 'exceljs';
import type { ReportData } from '../modules/reports/reports.service';

function escapeCsvCell(value: string | number): string {
  const str = String(value);
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
  report.rows.forEach((row) => sheet.addRow(row));

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
