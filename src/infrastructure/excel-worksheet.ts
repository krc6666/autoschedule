import * as XLSX from "xlsx-js-style";

import { normalizeText } from "../utils";

export type Row = unknown[];

export function rows(workbook: XLSX.WorkBook, sheetName: string): Row[] {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return [];
  return XLSX.utils.sheet_to_json<Row>(worksheet, {
    header: 1,
    raw: false,
    defval: "",
  });
}

export function findSheet(
  workbook: XLSX.WorkBook,
  candidates: string[]
): string | undefined {
  return workbook.SheetNames.find((name) =>
    candidates.some((candidate) => name.includes(candidate))
  );
}

export function headerIndex(
  header: Row,
  candidates: string[],
  fallback: number
): number {
  const index = header.findIndex((value) =>
    candidates.some((candidate) => normalizeText(value).includes(candidate))
  );
  return index >= 0 ? index : fallback;
}

export function normalizePosition(value: unknown): string {
  return normalizeText(value).replace(/^HO(?=\d)/i, "H0");
}

export function sheet(rowsData: unknown[][], widths: number[]): XLSX.WorkSheet {
  const worksheet = XLSX.utils.aoa_to_sheet(rowsData);
  worksheet["!cols"] = widths.map((wch) => ({ wch }));
  return worksheet;
}

export function append(
  workbook: XLSX.WorkBook,
  name: string,
  rowsData: unknown[][],
  widths: number[]
): void {
  XLSX.utils.book_append_sheet(workbook, sheet(rowsData, widths), name);
}
