import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

async function main() {
  const p = 'C:\\Users\\Lukas\\Downloads\\MFinanceiro_Relatorio_Transacoes_1776901366858.xlsx';
  const b = await readFile(p);
  const wb = XLSX.read(b, { type: 'buffer' });
  console.log('sheets', wb.SheetNames);
  for (const s of wb.SheetNames) {
    const sh = wb.Sheets[s];
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, raw: false, defval: '' }) as string[][];
    console.log('---', s, 'rows', rows.length);
    console.log(rows.slice(0, 12));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

