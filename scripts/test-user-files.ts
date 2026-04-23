import { readFile } from 'node:fs/promises';
import {
  detectFileFormat,
  parseSpreadsheetTransactions,
} from '../src/components/ImportarExtratos';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function main() {
  const pdfPath = 'C:\\Users\\Lukas\\Downloads\\MFinanceiro_Portfolio_1776904377757.pdf';
  const xlsxPath = 'C:\\Users\\Lukas\\Downloads\\MFinanceiro_Relatorio_Transacoes_1776901366858.xlsx';

  const [pdfBuf, xlsxBuf] = await Promise.all([readFile(pdfPath), readFile(xlsxPath)]);

  const pdfFile = new File([pdfBuf], 'MFinanceiro_Portfolio_1776904377757.pdf', {
    type: 'application/pdf',
    lastModified: Date.now(),
  });
  const xlsxFile = new File([xlsxBuf], 'MFinanceiro_Relatorio_Transacoes_1776901366858.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    lastModified: Date.now(),
  });

  const xlsxDetected = detectFileFormat(xlsxFile);
  const xlsxParsed = await parseSpreadsheetTransactions(xlsxFile, 'auto');

  const pdfDetected = detectFileFormat(pdfFile);
  const pdfDoc = await getDocument({ data: new Uint8Array(pdfBuf), disableWorker: true } as any).promise;
  let pdfText = '';
  let textItems = 0;
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    textItems += content.items.length;
    for (const item of content.items as Array<{ str: string }>) {
      pdfText += ` ${item.str}`;
    }
  }
  const normalizedPdf = pdfText.replace(/\s+/g, ' ').trim();
  const hasDateAndAmount =
    /\b\d{2}[./-]\d{2}(?:[./-]\d{2,4})?\b/.test(normalizedPdf) &&
    /(?:R\$\s*)?[+-]?\s*\d[\d.\s]*[,.]\d{2}-?/.test(normalizedPdf);

  console.log('=== XLSX ===');
  console.log({
    format: xlsxDetected.formatLabel,
    parser: xlsxDetected.parserLabel,
    total: xlsxParsed.length,
    valid: xlsxParsed.filter((t) => t.status === 'ready').length,
  });
  console.log('Amostra XLSX:', xlsxParsed.slice(0, 3).map((t) => ({
    date: t.date,
    description: t.description,
    amount: t.amount,
    type: t.type,
    source: t.source,
    categorySuggestion: t.categorySuggestion,
  })));

  console.log('\n=== PDF ===');
  console.log({
    format: pdfDetected.formatLabel,
    parser: pdfDetected.parserLabel,
    pages: pdfDoc.numPages,
    textItems,
    textLength: normalizedPdf.length,
    hasDateAndAmount,
  });
  console.log('Amostra texto PDF:', normalizedPdf.slice(0, 240));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
