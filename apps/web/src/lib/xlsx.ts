import { XLSX_TYPE, xlsxBytes, type SheetCell } from '@ledgernest/shared';

export { csvToRows, type SheetCell } from '@ledgernest/shared';

/** A workbook of sheets, ready to download; the first row of each is bold, as its header */
export function xlsx(sheets: { name: string; rows: SheetCell[][] }[]): Blob {
  return new Blob([xlsxBytes(sheets).buffer as ArrayBuffer], { type: XLSX_TYPE });
}
