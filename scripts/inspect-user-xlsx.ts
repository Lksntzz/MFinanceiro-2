import { readFile } from 'node:fs/promises';
import readXlsxFile from 'read-excel-file/node';

async function main() {
  const p = 'C:\\Users\\Lukas\\Downloads\\MFinanceiro_Relatorio_Transacoes_1776901366858.xlsx';
  const b = await readFile(p);
  const sheets = await readXlsxFile(b);
  console.log('sheets', sheets.map((sheet) => sheet.sheet));
  for (const sheet of sheets) {
    console.log('---', sheet.sheet, 'rows', sheet.data.length);
    console.log(sheet.data.slice(0, 12));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
