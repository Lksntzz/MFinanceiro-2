import type { SheetData } from 'write-excel-file/browser';

export interface WorkbookSheet {
  name: string;
  rows: SheetData;
  columnWidths?: number[];
}

export async function downloadXlsx(
  fileName: string,
  sheets: WorkbookSheet[],
): Promise<void> {
  if (sheets.length === 0)
    throw new Error('Nenhuma planilha foi informada para exportação.');

  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const workbook = sheets.map((sheet) => ({
    sheet: sheet.name,
    data: sheet.rows,
    columns: sheet.columnWidths?.map((width) => ({ width })),
  }));

  await writeXlsxFile(workbook).toFile(fileName);
}
