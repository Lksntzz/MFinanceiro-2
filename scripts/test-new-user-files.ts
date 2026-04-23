import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  detectFileFormat,
  parseCsvTransactions,
  parseSpreadsheetTransactions,
} from '../src/components/ImportarExtratos';
import {
  normalizeHeader,
  parseAmount,
  parseByDateAndCurrencyLines,
  parseByBlockRegex,
} from '../src/lib/import-parsers/pdf/utils';

type FileReport = {
  file: string;
  format: string;
  parser: string;
  total: number;
  valid: number;
  sample?: Array<{ date?: string; description: string; amount: number; type?: string }>;
  notes?: string[];
};

async function runCsv(path: string): Promise<FileReport> {
  const raw = await readFile(path, 'utf-8');
  const file = new File([raw], path.split('\\').pop() || 'statement.csv', { type: 'text/csv' });
  const detect = detectFileFormat(file);
  const parsed = parseCsvTransactions(raw, 'auto');
  const valid = parsed.filter((t) => t.status === 'ready').length;
  return {
    file: file.name,
    format: detect.formatLabel,
    parser: detect.parserLabel,
    total: parsed.length,
    valid,
    sample: parsed.slice(0, 5).map((t) => ({
      date: t.date,
      description: t.description,
      amount: t.amount,
      type: t.type,
    })),
    notes: valid === 0 ? ['Nenhuma linha validada no parser CSV'] : undefined,
  };
}

async function runXlsx(path: string): Promise<FileReport> {
  const raw = await readFile(path);
  const file = new File([raw], path.split('\\').pop() || 'statement.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const detect = detectFileFormat(file);
  const parsed = await parseSpreadsheetTransactions(file, 'auto');
  const valid = parsed.filter((t) => t.status === 'ready').length;
  return {
    file: file.name,
    format: detect.formatLabel,
    parser: detect.parserLabel,
    total: parsed.length,
    valid,
    sample: parsed.slice(0, 5).map((t) => ({
      date: t.date,
      description: t.description,
      amount: t.amount,
      type: t.type,
    })),
    notes: valid === 0 ? ['Nenhuma linha validada no parser XLSX'] : undefined,
  };
}

async function runPdf(path: string): Promise<FileReport> {
  const raw = await readFile(path);
  const file = new File([raw], path.split('\\').pop() || 'statement.pdf', { type: 'application/pdf' });
  const detect = detectFileFormat(file);
  const pdfDoc = await getDocument({ data: new Uint8Array(raw), disableWorker: true } as any).promise;

  const lines: string[] = [];
  let text = '';
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; text: string }[]>();
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x: item.transform[4], text: item.str });
      text += ` ${item.str}`;
    }
    const ys = [...rows.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const line = rows
        .get(y)!
        .sort((a, b) => a.x - b.x)
        .map((p) => p.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) lines.push(line);
    }
  }

  const context = { lines, fullText: text, normalize: normalizeHeader, parseAmount };
  const byLines = parseByDateAndCurrencyLines(context);
  const byBlock = byLines.length > 0 ? [] : parseByBlockRegex(context);
  const extracted = byLines.length > 0 ? byLines : byBlock;

  const valid = extracted.filter((e) => Math.abs(e.signedAmount) > 0 && e.description).length;
  return {
    file: file.name,
    format: detect.formatLabel,
    parser: detect.parserLabel,
    total: extracted.length,
    valid,
    sample: extracted.slice(0, 5).map((e) => ({
      date: e.rawDate,
      description: e.description,
      amount: Math.abs(e.signedAmount),
      type: e.signedAmount >= 0 ? 'income' : 'expense',
    })),
    notes: [
      `Paginas: ${pdfDoc.numPages}`,
      `Linhas extraidas: ${lines.length}`,
      `Texto bruto (amostra): ${text.replace(/\s+/g, ' ').trim().slice(0, 220)}`,
      byLines.length > 0 ? 'Parser PDF: date+currency lines' : 'Parser PDF: block regex fallback',
      ...(valid === 0 ? ['Nenhuma linha validada no parser PDF'] : []),
    ],
  };
}

async function main() {
  const csvPath = 'C:\\Users\\Lukas\\Downloads\\account_statement_5e9bdcaf-9cc5-42d0-9101-767288194621.csv';
  const xlsxPath = 'C:\\Users\\Lukas\\Downloads\\account_statement_5e9bdcaf-9cc5-42d0-9101-767288194621.xlsx';
  const pdfPath = 'C:\\Users\\Lukas\\Downloads\\MercadoPago.pdf';

  const reports: FileReport[] = [];
  reports.push(await runCsv(csvPath));
  reports.push(await runXlsx(xlsxPath));
  reports.push(await runPdf(pdfPath));

  for (const report of reports) {
    console.log('\n==============================');
    console.log(report.file);
    console.log({ format: report.format, parser: report.parser, total: report.total, valid: report.valid });
    if (report.sample?.length) {
      console.log('Amostra:');
      for (const s of report.sample) console.log(s);
    }
    if (report.notes?.length) {
      console.log('Notas:');
      for (const n of report.notes) console.log('-', n);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

